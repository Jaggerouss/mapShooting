# 飞镖扎地图小程序 —— 项目说明

## 关于这个仓库

这个仓库用于维护多个微信小程序 demo，每个小程序单独放在 `apps/` 下的子目录里，共用同一个 git 仓库。当前包含：

- `apps/dart-map/` —— 飞镖扎地图（本文档主要说明这个）
- `apps/test-app/` —— 测试用占位小程序

`project.config.json` 里的 `miniprogramRoot` / `srcMiniprogramRoot` 决定微信开发者工具打开的是哪一个小程序，切换项目只需要改这两个字段的路径，其余配置不用动。

## 怎么跑起来

1. 打开微信开发者工具 → 导入项目
2. 目录选仓库根目录（包含 `project.config.json` 的这一层）
3. 确认 `project.config.json` 里 `miniprogramRoot` 指向 `apps/dart-map/`
4. AppID 选"测试号"，或者用已有的 appid 替换 `project.config.json` 里的 `appid` 字段
5. 编译，首页应该能直接看到（背景图是占位图）

## 目录结构

```
project.config.json              开发者工具项目配置（miniprogramRoot 控制当前打开的小程序）
DEVNOTES.md                      开发笔记 + bug 修复记录
apps/
  dart-map/                      飞镖扎地图小程序
    app.js / app.json / app.wxss   小程序入口和全局配置
    sitemap.json                   索引配置（app.json 里引用）
    pages/index/                   首页：背景图 + 开始游戏按钮 + 最近使用/预设地图
    pages/game/                    游戏页：上传/更换地图 + 力度摇杆 + 投掷 + 命中放大镜
    assets/images/home_bg.jpg      首页背景图（占位图，建议替换成你自己的）
    assets/audio/                  背景音乐 + 命中音效（还没放，见里面的说明文件）
  test-app/                      测试用占位小程序（验证多项目切换方案）
```

## 新增一个小程序

1. `mkdir apps/新项目名/`，在里面搭建 `app.js`、`app.json`、`app.wxss`、`pages/` 等标准小程序结构
2. 修改 `project.config.json`：
   ```json
   "miniprogramRoot": "apps/新项目名/",
   "srcMiniprogramRoot": "apps/新项目名/"
   ```
3. 微信开发者工具刷新项目即可切换

## 还差什么（需要你自己补，针对 dart-map）

- `apps/dart-map/assets/images/home_bg.jpg` —— 现在是占位图（浅绿色几何块+文字），建议换成你想用的首页背景
- `apps/dart-map/assets/audio/bgm.mp3`、`dart_hit.mp3` —— 还没有，看 `assets/audio/请补充音频_README.txt` 里的说明，放进去文件名对上就行，代码不用改

## 已实现的功能（MVP）

- 首页：背景图 + 开始游戏 + 最近使用地图（点击可直接带图进游戏）
- 游戏页：
  - 上传地图图片，自动缩放到适合屏幕的展示宽度（小图放大不超过 2.5 倍、大图等比缩小）
  - 力度滑杆 + 方向摇杆控制投掷
  - 投掷落点 = 理论计算落点 + 随机扰动（力度越极端扰动越大），保证落点在图内
  - 命中位置：十字参考线 + 双层靶心 + 右上角放大镜（放大 2.5 倍看清具体扎在哪）
  - 顶部"更换地图"按钮，随时可以换图重新开始
  - 背景音乐自动播放，右上角可开关；命中有震动 + 音效反馈

## 已知待办（P1，未实现）

- 历史记录（投掷记录列表）
- 手动标注地图分区/地点名称，命中后播报具体地点名字
- 结果分享（生成带标记的图片分享出去）
