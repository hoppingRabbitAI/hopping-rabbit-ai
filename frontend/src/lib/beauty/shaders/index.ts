/**
 * 美颜 WebGL 着色器集合
 */

// ==================== 顶点着色器 ====================

/** 默认顶点着色器 */
export const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

/** 带变形的顶点着色器 */
export const WARP_VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  
  uniform vec2 u_warpPoints[32];    // 变形控制点
  uniform vec2 u_warpOffsets[32];   // 变形偏移
  uniform float u_warpWeights[32];  // 变形权重
  uniform int u_warpCount;          // 变形点数量
  
  varying vec2 v_texCoord;
  
  void main() {
    vec2 pos = a_position;
    
    // 应用变形
    for (int i = 0; i < 32; i++) {
      if (i >= u_warpCount) break;
      
      float dist = distance(a_texCoord, u_warpPoints[i]);
      float weight = u_warpWeights[i];
      float influence = exp(-dist * dist / (weight * weight));
      
      pos += u_warpOffsets[i] * influence;
    }
    
    gl_Position = vec4(pos, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

// ==================== 磨皮着色器 ====================

/** 双边滤波磨皮着色器 */
export const SKIN_SMOOTH_SHADER = `
  precision highp float;
  
  uniform sampler2D u_texture;
  uniform vec2 u_texelSize;     // 1.0 / 纹理尺寸
  uniform float u_intensity;     // 磨皮强度 0-1
  uniform float u_threshold;     // 边缘保留阈值
  
  varying vec2 v_texCoord;
  
  // 高斯权重
  float gaussian(float x, float sigma) {
    return exp(-(x * x) / (2.0 * sigma * sigma));
  }
  
  // RGB转YUV
  vec3 rgb2yuv(vec3 rgb) {
    float y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    float u = -0.147 * rgb.r - 0.289 * rgb.g + 0.436 * rgb.b;
    float v = 0.615 * rgb.r - 0.515 * rgb.g - 0.100 * rgb.b;
    return vec3(y, u, v);
  }
  
  // 检测是否是皮肤区域
  bool isSkin(vec3 color) {
    vec3 yuv = rgb2yuv(color);
    return yuv.r > 0.2 && yuv.r < 0.9 && 
           abs(yuv.g) < 0.15 && 
           yuv.b > 0.0 && yuv.b < 0.25;
  }
  
  void main() {
    vec4 center = texture2D(u_texture, v_texCoord);
    
    // 非皮肤区域不处理
    if (!isSkin(center.rgb) || u_intensity < 0.01) {
      gl_FragColor = center;
      return;
    }
    
    // 双边滤波
    vec3 sum = vec3(0.0);
    float weightSum = 0.0;
    
    float spatialSigma = 3.0 + u_intensity * 5.0;  // 空间sigma
    float rangeSigma = 0.1 + u_intensity * 0.3;    // 颜色范围sigma
    
    int radius = int(spatialSigma);
    
    for (int x = -8; x <= 8; x++) {
      for (int y = -8; y <= 8; y++) {
        if (abs(x) > radius || abs(y) > radius) continue;
        
        vec2 offset = vec2(float(x), float(y)) * u_texelSize;
        vec4 sample_color = texture2D(u_texture, v_texCoord + offset);
        
        // 空间权重
        float spatialDist = length(vec2(float(x), float(y)));
        float spatialWeight = gaussian(spatialDist, spatialSigma);
        
        // 颜色范围权重
        float colorDist = distance(sample_color.rgb, center.rgb);
        float rangeWeight = gaussian(colorDist, rangeSigma);
        
        // 边缘保护
        float edgeWeight = colorDist < u_threshold ? 1.0 : 0.3;
        
        float weight = spatialWeight * rangeWeight * edgeWeight;
        sum += sample_color.rgb * weight;
        weightSum += weight;
      }
    }
    
    vec3 blurred = sum / weightSum;
    
    // 混合原图和模糊结果
    vec3 result = mix(center.rgb, blurred, u_intensity);
    
    gl_FragColor = vec4(result, center.a);
  }
`;

// ==================== 美白着色器 ====================

/** 美白着色器 */
export const WHITENING_SHADER = `
  precision highp float;
  
  uniform sampler2D u_texture;
  uniform float u_intensity;    // 美白强度 0-1
  
  varying vec2 v_texCoord;
  
  // RGB转HSL
  vec3 rgb2hsl(vec3 color) {
    float maxc = max(max(color.r, color.g), color.b);
    float minc = min(min(color.r, color.g), color.b);
    float l = (maxc + minc) / 2.0;
    
    if (maxc == minc) {
      return vec3(0.0, 0.0, l);
    }
    
    float d = maxc - minc;
    float s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
    
    float h;
    if (maxc == color.r) {
      h = (color.g - color.b) / d + (color.g < color.b ? 6.0 : 0.0);
    } else if (maxc == color.g) {
      h = (color.b - color.r) / d + 2.0;
    } else {
      h = (color.r - color.g) / d + 4.0;
    }
    h /= 6.0;
    
    return vec3(h, s, l);
  }
  
  // HSL转RGB
  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
  }
  
  vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x;
    float s = hsl.y;
    float l = hsl.z;
    
    if (s == 0.0) {
      return vec3(l, l, l);
    }
    
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    
    float r = hue2rgb(p, q, h + 1.0/3.0);
    float g = hue2rgb(p, q, h);
    float b = hue2rgb(p, q, h - 1.0/3.0);
    
    return vec3(r, g, b);
  }
  
  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    
    if (u_intensity < 0.01) {
      gl_FragColor = color;
      return;
    }
    
    // 转换到HSL
    vec3 hsl = rgb2hsl(color.rgb);
    
    // 提亮
    float lightnessBoost = u_intensity * 0.15;
    hsl.z = min(hsl.z + lightnessBoost, 1.0);
    
    // 略微降低饱和度使肤色更白皙
    hsl.y = max(hsl.y - u_intensity * 0.1, 0.0);
    
    // 对偏红/偏黄肤色特别处理
    if (hsl.x > 0.0 && hsl.x < 0.15) {
      // 降低黄色调
      hsl.y = max(hsl.y - u_intensity * 0.05, 0.0);
    }
    
    vec3 result = hsl2rgb(hsl);
    
    // 曲线提亮暗部
    result = pow(result, vec3(1.0 - u_intensity * 0.2));
    
    gl_FragColor = vec4(result, color.a);
  }
`;

// ==================== 锐化着色器 ====================

/** USM锐化着色器 */
export const SHARPEN_SHADER = `
  precision highp float;
  
  uniform sampler2D u_texture;
  uniform vec2 u_texelSize;
  uniform float u_intensity;    // 锐化强度 0-1
  
  varying vec2 v_texCoord;
  
  void main() {
    vec4 center = texture2D(u_texture, v_texCoord);
    
    if (u_intensity < 0.01) {
      gl_FragColor = center;
      return;
    }
    
    // 拉普拉斯算子
    vec4 top = texture2D(u_texture, v_texCoord + vec2(0.0, -u_texelSize.y));
    vec4 bottom = texture2D(u_texture, v_texCoord + vec2(0.0, u_texelSize.y));
    vec4 left = texture2D(u_texture, v_texCoord + vec2(-u_texelSize.x, 0.0));
    vec4 right = texture2D(u_texture, v_texCoord + vec2(u_texelSize.x, 0.0));
    
    // 计算边缘
    vec4 edge = 4.0 * center - top - bottom - left - right;
    
    // 应用锐化
    float amount = u_intensity * 1.5;
    vec4 result = center + edge * amount;
    
    gl_FragColor = vec4(clamp(result.rgb, 0.0, 1.0), center.a);
  }
`;

// ==================== 颜色调整着色器 ====================

/** 颜色调整着色器 (亮度/对比度/饱和度/色温) */
export const COLOR_ADJUST_SHADER = `
  precision highp float;
  
  uniform sampler2D u_texture;
  uniform float u_brightness;   // -1 to 1
  uniform float u_contrast;     // -1 to 1
  uniform float u_saturation;   // -1 to 1
  uniform float u_temperature;  // -1 to 1
  uniform float u_tint;         // -1 to 1
  uniform float u_shadows;      // -1 to 1
  uniform float u_highlights;   // -1 to 1
  uniform float u_vibrance;     // -1 to 1
  
  varying vec2 v_texCoord;
  
  // 亮度计算
  float luminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }
  
  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    vec3 rgb = color.rgb;
    
    // 亮度调整
    rgb += u_brightness;
    
    // 对比度调整
    rgb = (rgb - 0.5) * (1.0 + u_contrast) + 0.5;
    
    // 饱和度调整
    float lum = luminance(rgb);
    rgb = mix(vec3(lum), rgb, 1.0 + u_saturation);
    
    // 色温调整 (暖/冷)
    rgb.r += u_temperature * 0.1;
    rgb.b -= u_temperature * 0.1;
    
    // 色调调整
    rgb.r += u_tint * 0.05;
    rgb.g -= u_tint * 0.05;
    
    // 阴影/高光调整
    float shadow = smoothstep(0.0, 0.5, lum);
    float highlight = smoothstep(0.5, 1.0, lum);
    
    rgb += (1.0 - shadow) * u_shadows * 0.2;
    rgb -= highlight * u_highlights * 0.2;
    
    // 自然饱和度
    float satDiff = 1.0 - abs(u_saturation);
    float vibAmount = u_vibrance * satDiff;
    float currentSat = max(max(rgb.r, rgb.g), rgb.b) - min(min(rgb.r, rgb.g), rgb.b);
    rgb = mix(vec3(lum), rgb, 1.0 + vibAmount * (1.0 - currentSat));
    
    gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
  }
`;

// ==================== LUT滤镜着色器 ====================

/** LUT 3D查找表着色器 */
export const LUT_SHADER = `
  precision highp float;
  
  uniform sampler2D u_texture;
  uniform sampler2D u_lutTexture;
  uniform float u_intensity;    // 滤镜强度 0-1
  uniform float u_lutSize;      // LUT尺寸 (通常64)
  
  varying vec2 v_texCoord;
  
  vec4 sampleLut(vec3 color) {
    float blueSlice = color.b * (u_lutSize - 1.0);
    float blueSliceLow = floor(blueSlice);
    float blueSliceHigh = ceil(blueSlice);
    float blueSliceFrac = blueSlice - blueSliceLow;
    
    // 在LUT中的UV坐标
    vec2 uvLow = vec2(
      (blueSliceLow + color.r) / u_lutSize,
      color.g
    );
    vec2 uvHigh = vec2(
      (blueSliceHigh + color.r) / u_lutSize,
      color.g
    );
    
    vec4 colorLow = texture2D(u_lutTexture, uvLow);
    vec4 colorHigh = texture2D(u_lutTexture, uvHigh);
    
    return mix(colorLow, colorHigh, blueSliceFrac);
  }
  
  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    
    if (u_intensity < 0.01) {
      gl_FragColor = color;
      return;
    }
    
    vec4 lutColor = sampleLut(clamp(color.rgb, 0.0, 1.0));
    
    gl_FragColor = vec4(mix(color.rgb, lutColor.rgb, u_intensity), color.a);
  }
`;

// ==================== 变形着色器 ====================

/** 网格变形着色器 (用于瘦脸/大眼等) */
export const WARP_SHADER = `
  precision highp float;
  
  uniform sampler2D u_texture;
  uniform vec2 u_center;        // 变形中心
  uniform vec2 u_direction;     // 变形方向
  uniform float u_radius;       // 变形半径
  uniform float u_strength;     // 变形强度
  uniform int u_type;           // 变形类型: 0=收缩, 1=膨胀, 2=移动
  
  varying vec2 v_texCoord;
  
  void main() {
    vec2 uv = v_texCoord;
    vec2 toCenter = uv - u_center;
    float dist = length(toCenter);
    
    if (dist < u_radius && u_strength > 0.001) {
      float percent = 1.0 - dist / u_radius;
      float factor = percent * percent * u_strength;
      
      if (u_type == 0) {
        // 收缩 (瘦脸)
        uv = u_center + toCenter * (1.0 + factor);
      } else if (u_type == 1) {
        // 膨胀 (大眼)
        uv = u_center + toCenter * (1.0 - factor * 0.5);
      } else {
        // 移动
        uv -= u_direction * factor;
      }
    }
    
    gl_FragColor = texture2D(u_texture, clamp(uv, 0.0, 1.0));
  }
`;

/** 多点变形着色器 */
export const MULTI_WARP_SHADER = `
  precision highp float;
  
  #define MAX_WARP_POINTS 16
  
  uniform sampler2D u_texture;
  uniform vec2 u_warpCenters[MAX_WARP_POINTS];
  uniform vec2 u_warpDirections[MAX_WARP_POINTS];
  uniform float u_warpRadii[MAX_WARP_POINTS];
  uniform float u_warpStrengths[MAX_WARP_POINTS];
  uniform int u_warpTypes[MAX_WARP_POINTS];
  uniform int u_warpCount;
  
  varying vec2 v_texCoord;
  
  void main() {
    vec2 uv = v_texCoord;
    
    for (int i = 0; i < MAX_WARP_POINTS; i++) {
      if (i >= u_warpCount) break;
      
      vec2 center = u_warpCenters[i];
      vec2 direction = u_warpDirections[i];
      float radius = u_warpRadii[i];
      float strength = u_warpStrengths[i];
      int type = u_warpTypes[i];
      
      vec2 toCenter = uv - center;
      float dist = length(toCenter);
      
      if (dist < radius && strength > 0.001) {
        float percent = 1.0 - dist / radius;
        float factor = percent * percent * strength;
        
        if (type == 0) {
          // 收缩
          uv = center + toCenter * (1.0 + factor);
        } else if (type == 1) {
          // 膨胀
          uv = center + toCenter * (1.0 - factor * 0.5);
        } else {
          // 移动
          uv -= direction * factor;
        }
      }
    }
    
    gl_FragColor = texture2D(u_texture, clamp(uv, 0.0, 1.0));
  }
`;

// ==================== 导出着色器映射 ====================

export const BEAUTY_SHADERS = {
  vertex: VERTEX_SHADER,
  warpVertex: WARP_VERTEX_SHADER,
  skinSmooth: SKIN_SMOOTH_SHADER,
  whitening: WHITENING_SHADER,
  sharpen: SHARPEN_SHADER,
  colorAdjust: COLOR_ADJUST_SHADER,
  lut: LUT_SHADER,
  warp: WARP_SHADER,
  multiWarp: MULTI_WARP_SHADER,
};
