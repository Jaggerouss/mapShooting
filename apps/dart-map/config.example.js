// 腾讯位置服务 Key 配置（模板文件，可提交到 git）
//
// 使用方法：复制这个文件为 config.js（同目录下），config.js 已在 .gitignore 中，不会被提交
//   cp config.example.js config.js
//
// 1. 打开 https://lbs.qq.com 注册/登录
// 2. 控制台 → 应用管理 → 创建应用 → 创建 Key（勾选 WebServiceAPI 权限，包含逆地理编码）
// 3. 把 Key 填到 config.js 里的 TENCENT_MAP_KEY
// 4. 去微信公众平台后台 → 开发 → 开发设置 → 服务器域名，
//    把 https://apis.map.qq.com 加入 request 合法域名（开发工具里可以先勾选"不校验合法域名"测试）
//
// 没填 Key 之前，投掷依然可以生成随机坐标，只是不会显示具体地名。

module.exports = {
  TENCENT_MAP_KEY: "",
};
