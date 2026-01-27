/**
 * WebGL 渲染器
 * 用于GPU加速的图像处理
 */

import type { 
  ShaderUniforms, 
  ProgramInfo,
  EffectType 
} from '../types';

import { 
  DEFAULT_VERTEX_SHADER, 
  PASSTHROUGH_FRAGMENT_SHADER 
} from '../constants';

export class WebGLRenderer {
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private programs: Map<string, ProgramInfo> = new Map();
  private textures: Map<string, WebGLTexture> = new Map();
  private framebuffers: Map<string, WebGLFramebuffer> = new Map();
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private isInitialized = false;
  
  constructor(width: number = 1280, height: number = 720) {
    // 创建离屏Canvas
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(width, height);
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
  
  /**
   * 初始化WebGL上下文
   */
  initialize(): boolean {
    if (this.isInitialized) return true;
    
    try {
      // 优先使用WebGL2
      this.gl = this.canvas.getContext('webgl2', {
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        antialias: false,
      }) as WebGL2RenderingContext;
      
      if (!this.gl) {
        // 降级到WebGL1
        this.gl = this.canvas.getContext('webgl', {
          premultipliedAlpha: false,
          preserveDrawingBuffer: true,
          antialias: false,
        }) as WebGLRenderingContext;
      }
      
      if (!this.gl) {
        console.error('[WebGLRenderer] WebGL不可用');
        return false;
      }
      
      // 初始化顶点缓冲
      this.initBuffers();
      
      // 编译默认着色器程序
      this.compileProgram('passthrough', DEFAULT_VERTEX_SHADER, PASSTHROUGH_FRAGMENT_SHADER);
      
      this.isInitialized = true;
      console.log('[WebGLRenderer] 初始化完成');
      return true;
    } catch (error) {
      console.error('[WebGLRenderer] 初始化失败:', error);
      return false;
    }
  }
  
  /**
   * 初始化顶点缓冲
   */
  private initBuffers(): void {
    if (!this.gl) return;
    
    const gl = this.gl;
    
    // 位置缓冲 (全屏四边形)
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]), gl.STATIC_DRAW);
    
    // 纹理坐标缓冲
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]), gl.STATIC_DRAW);
  }
  
  /**
   * 编译着色器程序
   */
  compileProgram(
    name: string, 
    vertexSource: string, 
    fragmentSource: string
  ): ProgramInfo | null {
    if (!this.gl) return null;
    
    const gl = this.gl;
    
    // 编译顶点着色器
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    if (!vertexShader) return null;
    
    // 编译片段着色器
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!fragmentShader) {
      gl.deleteShader(vertexShader);
      return null;
    }
    
    // 创建程序
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return null;
    }
    
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[WebGLRenderer] 程序链接失败:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return null;
    }
    
    // 获取属性和uniform位置
    const programInfo: ProgramInfo = {
      program,
      attribLocations: {
        position: gl.getAttribLocation(program, 'a_position'),
        texCoord: gl.getAttribLocation(program, 'a_texCoord'),
      },
      uniformLocations: {},
    };
    
    // 获取所有uniform位置
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const uniformInfo = gl.getActiveUniform(program, i);
      if (uniformInfo) {
        programInfo.uniformLocations[uniformInfo.name] = gl.getUniformLocation(program, uniformInfo.name);
      }
    }
    
    this.programs.set(name, programInfo);
    
    // 清理着色器对象
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    
    return programInfo;
  }
  
  /**
   * 编译单个着色器
   */
  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    
    const gl = this.gl;
    const shader = gl.createShader(type);
    
    if (!shader) return null;
    
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[WebGLRenderer] 着色器编译失败:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }
  
  /**
   * 创建纹理
   */
  createTexture(
    name: string,
    source?: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap | ImageData,
    width?: number,
    height?: number
  ): WebGLTexture | null {
    if (!this.gl) return null;
    
    const gl = this.gl;
    
    // 如果已存在则删除
    if (this.textures.has(name)) {
      gl.deleteTexture(this.textures.get(name)!);
    }
    
    const texture = gl.createTexture();
    if (!texture) return null;
    
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    // 设置纹理参数
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    if (source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else if (width && height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    
    this.textures.set(name, texture);
    return texture;
  }
  
  /**
   * 更新纹理数据
   */
  updateTexture(
    name: string,
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap | ImageData
  ): void {
    if (!this.gl) return;
    
    const gl = this.gl;
    const texture = this.textures.get(name);
    
    if (!texture) {
      this.createTexture(name, source);
      return;
    }
    
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  
  /**
   * 创建帧缓冲
   */
  createFramebuffer(name: string, width: number, height: number): WebGLFramebuffer | null {
    if (!this.gl) return null;
    
    const gl = this.gl;
    
    // 如果已存在则删除
    if (this.framebuffers.has(name)) {
      gl.deleteFramebuffer(this.framebuffers.get(name)!);
    }
    
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) return null;
    
    // 创建关联纹理
    const texture = this.createTexture(`${name}_texture`, undefined, width, height);
    if (!texture) {
      gl.deleteFramebuffer(framebuffer);
      return null;
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    
    // 检查帧缓冲完整性
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('[WebGLRenderer] 帧缓冲不完整:', status);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    this.framebuffers.set(name, framebuffer);
    return framebuffer;
  }
  
  /**
   * 渲染到目标
   */
  render(
    programName: string,
    uniforms: ShaderUniforms = {},
    targetFramebuffer?: string
  ): void {
    if (!this.gl) return;
    
    const gl = this.gl;
    const programInfo = this.programs.get(programName);
    
    if (!programInfo) {
      console.error(`[WebGLRenderer] 程序 ${programName} 不存在`);
      return;
    }
    
    // 绑定目标帧缓冲
    if (targetFramebuffer) {
      const fb = this.framebuffers.get(targetFramebuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb || null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    
    // 设置视口
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    // 使用程序
    gl.useProgram(programInfo.program);
    
    // 绑定位置属性
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(programInfo.attribLocations.position);
    gl.vertexAttribPointer(programInfo.attribLocations.position, 2, gl.FLOAT, false, 0, 0);
    
    // 绑定纹理坐标属性
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(programInfo.attribLocations.texCoord);
    gl.vertexAttribPointer(programInfo.attribLocations.texCoord, 2, gl.FLOAT, false, 0, 0);
    
    // 设置uniforms
    this.setUniforms(programInfo, uniforms);
    
    // 绘制
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  
  /**
   * 设置uniform值
   */
  private setUniforms(programInfo: ProgramInfo, uniforms: ShaderUniforms): void {
    if (!this.gl) return;
    
    const gl = this.gl;
    let textureUnit = 0;
    
    for (const [name, value] of Object.entries(uniforms)) {
      const location = programInfo.uniformLocations[name];
      if (!location) continue;
      
      if (value === null) continue;
      
      if (value instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.uniform1i(location, textureUnit);
        textureUnit++;
      } else if (typeof value === 'number') {
        gl.uniform1f(location, value);
      } else if (Array.isArray(value) || value instanceof Float32Array) {
        const arr = value as number[] | Float32Array;
        switch (arr.length) {
          case 2:
            gl.uniform2fv(location, arr);
            break;
          case 3:
            gl.uniform3fv(location, arr);
            break;
          case 4:
            gl.uniform4fv(location, arr);
            break;
          case 9:
            gl.uniformMatrix3fv(location, false, arr);
            break;
          case 16:
            gl.uniformMatrix4fv(location, false, arr);
            break;
          default:
            gl.uniform1fv(location, arr);
        }
      }
    }
  }
  
  /**
   * 调整画布大小
   */
  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
  
  /**
   * 获取画布
   */
  getCanvas(): HTMLCanvasElement | OffscreenCanvas {
    return this.canvas;
  }
  
  /**
   * 获取WebGL上下文
   */
  getContext(): WebGLRenderingContext | WebGL2RenderingContext | null {
    return this.gl;
  }
  
  /**
   * 获取纹理
   */
  getTexture(name: string): WebGLTexture | undefined {
    return this.textures.get(name);
  }
  
  /**
   * 读取像素数据
   */
  readPixels(): ImageData | null {
    if (!this.gl) return null;
    
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const pixels = new Uint8Array(width * height * 4);
    
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    
    // 翻转Y轴
    const flipped = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIndex = (y * width + x) * 4;
        const dstIndex = ((height - 1 - y) * width + x) * 4;
        flipped[dstIndex] = pixels[srcIndex];
        flipped[dstIndex + 1] = pixels[srcIndex + 1];
        flipped[dstIndex + 2] = pixels[srcIndex + 2];
        flipped[dstIndex + 3] = pixels[srcIndex + 3];
      }
    }
    
    return new ImageData(flipped, width, height);
  }
  
  /**
   * 销毁渲染器
   */
  dispose(): void {
    if (!this.gl) return;
    
    const gl = this.gl;
    
    // 删除纹理
    this.textures.forEach(texture => {
      gl.deleteTexture(texture);
    });
    this.textures.clear();
    
    // 删除帧缓冲
    this.framebuffers.forEach(framebuffer => {
      gl.deleteFramebuffer(framebuffer);
    });
    this.framebuffers.clear();
    
    // 删除程序
    this.programs.forEach(programInfo => {
      gl.deleteProgram(programInfo.program);
    });
    this.programs.clear();
    
    // 删除缓冲
    if (this.positionBuffer) {
      gl.deleteBuffer(this.positionBuffer);
    }
    if (this.texCoordBuffer) {
      gl.deleteBuffer(this.texCoordBuffer);
    }
    
    this.gl = null;
    this.isInitialized = false;
  }
  
  /**
   * 是否已初始化
   */
  get ready(): boolean {
    return this.isInitialized;
  }
}
