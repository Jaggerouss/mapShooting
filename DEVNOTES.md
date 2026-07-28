# 开发笔记

## 项目简介

微信小程序「飞镖选地方」，用户上传地图图片，通过力度滑杆 + 方向摇杆投掷飞镖，随机落点决定目的地。

---

## 技术架构

| 模块   | 文件                           | 说明                                            |
| ------ | ------------------------------ | ----------------------------------------------- |
| 入口   | `app.js / app.json / app.wxss` | 全局配置，目前仅留初始化占位                    |
| 首页   | `pages/index/`                 | 背景图、开始按钮、最近使用地图（Storage 缓存）  |
| 游戏页 | `pages/game/`                  | 核心玩法：地图加载、Canvas 绘制、摇杆、投掷算法 |
| 音频   | `assets/audio/`                | BGM + 命中音效（文件需自行补充，见目录内说明）  |
| 图片   | `assets/images/`               | 首页背景图（当前为占位图，建议替换）            |

### Canvas 渲染流程

```
loadMapImage()
  └─ setData({ mapSrc, canvasWidth, canvasHeight })
       └─ setupCanvas()          // 获取 canvas node，设置 DPR
            └─ drawMapImage()    // 加载并缓存 img 对象（_mapImg）
                 └─ paintFrame() // clearRect + drawImage [+ drawDartMark]
```

### 投掷算法

1. 以画布中心为起点，按角度和力度计算理论落点
2. 叠加高斯随机扰动（力度越极端扰动越大，0.7 附近最稳）
3. 边界夹取，保证落点始终在地图范围内
4. `animateThrow` 使用 `requestAnimationFrame` + easeOutCubic 做弧线飞行动画

---

## Bug 修复记录

### 2026-07-23

#### Bug 1：「再投一次」后旧飞镖标记残留在 Canvas

- **位置**：`pages/game/game.js` → `throwAgain()`
- **原因**：只调用了 `setData({ showResult: false })`，未重绘 canvas，导致上一次的命中十字线 + 靶心一直显示
- **修复**：`throwAgain` 中追加 `this.drawMapImage()` 调用，重绘干净地图

```js
// 修复前
throwAgain() {
  this.setData({ showResult: false });
},

// 修复后
throwAgain() {
  this.setData({ showResult: false });
  this.drawMapImage(); // 清除命中标记，还原干净地图
},
```

---

#### Bug 2：首页「最近使用地图」横向滚动失效

- **位置**：`pages/index/index.wxss` → `.recent-scroll`
- **原因**：`scroll-view` 开启 `scroll-x` 时必须有明确宽度，原来只设了 `white-space: nowrap`，在部分设备上无法滚动
- **修复**：补充 `width: 100%; display: block;`

```css
/* 修复前 */
.recent-scroll {
  white-space: nowrap;
}

/* 修复后 */
.recent-scroll {
  white-space: nowrap;
  width: 100%;
  display: block;
}
```

---

#### Bug 3：摇杆首次拖动位置跳变（竞态问题）

- **位置**：`pages/game/game.js` → `onStickStart()`
- **原因**：`boundingClientRect` 的 exec 回调是异步的。若用户手指在回调返回前已触发 `onStickMove`，此时 `_stickCenter` 仍为初始值 `{x:0, y:0}`，导致摇杆计算偏移量错误，knob 会瞬间跳到角落
- **修复**：
  1. 将 `boundingClientRect` 查询提取为 `_updateStickRect()` 方法
  2. 在地图加载完成后（`setData` 回调内）立即预取一次，保证首次触摸时数据已就绪
  3. `onStickStart` 仍调用一次，应对换图后布局高度变化的情况

```js
// 修复前
onStickStart(e) {
  const query = wx.createSelectorQuery().in(this);
  query.select('.joystick-base').boundingClientRect((rect) => {
    this._stickCenter = { x: rect.left + rect.width / 2, ... };
    this._stickRadius = rect.width / 2;
  }).exec();
},

// 修复后
_updateStickRect() {
  wx.createSelectorQuery().in(this)
    .select('.joystick-base')
    .boundingClientRect()
    .exec((res) => {
      if (!res[0]) return;
      this._stickCenter = { x: res[0].left + res[0].width / 2, ... };
      this._stickRadius = res[0].width / 2;
    });
},

onStickStart() {
  this._updateStickRect();
},

// loadMapImage setData 回调中：
() => {
  this.setupCanvas();
  this._updateStickRect(); // 预取，消除首次触摸竞态
}
```

---

## 已知待办（未实现功能）

| 优先级 | 功能           | 备注                                              |
| ------ | -------------- | ------------------------------------------------- |
| P1     | 历史记录列表   | 记录每次投掷坐标 + 对应地图缩略图                 |
| P1     | 地图分区标注   | 手动划定区域/地点名称，命中后播报具体地点         |
| P1     | 结果分享       | 生成带飞镖标记的图片，调用 `wx.shareImageMessage` |
| P2     | 多人模式       | 轮流投掷，统计每人结果                            |
| P2     | 自定义飞镖皮肤 | —                                                 |

---

## 本地运行

1. 打开**微信开发者工具** → 导入项目，选此目录（含 `app.json` 的这层）
2. AppID 选「测试号」，或填入已有 AppID
3. 补充音频文件（见 `assets/audio/请补充音频_README.txt`）
4. 编译，首页即可看到效果
