/**
 * Remotion 配置
 */
import { Config } from '@remotion/cli/config';

// 设置 Webpack 配置
Config.overrideWebpackConfig((currentConfiguration) => {
  return {
    ...currentConfiguration,
    resolve: {
      ...currentConfiguration.resolve,
      alias: {
        ...currentConfiguration.resolve?.alias,
        // 添加路径别名
        '@': './src',
      },
    },
  };
});

// 设置并发数
Config.setConcurrency(4);
