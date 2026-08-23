# 跟着 Jagger 去旅行 —— 飞镖选地方

用投飞镖的方式随机决定去哪玩的微信小程序。

**[▶ 在线演示](https://claude.ai/code/artifact/00dc1895-55ac-4b5b-91a1-f4556e76476f)** —— 网页复刻版，不用装开发者工具就能走完整个流程。动画和采样算法与真机一致，只有网络返回是模拟的。

---

## 玩法

```
首页                     游戏页
┌──────────────┐       ┌────────────────────────────┐
│ 选范围：      │       │ 按住「蓄力」，力度条来回摆动 │
│  上海市       │  ──▶  │ 松手 → 飞镖飞出 → 命中      │
│  青浦区       │       │ 震出 3 个候选，挑一个        │
│  华新镇       │       │ 确认弹窗：先探周边再问行不行  │
│ [开始游戏]    │       │ 确认后 → 周边推荐列表        │
└──────────────┘       └────────────────────────────┘
```

**力度决定远近。** 轻投落市区，重投落远郊 —— `power` 映射成距市中心的归一化环带，不是单纯的随机。

**落点是在真实行政区边界内均匀抽样的。** bbox 拒绝采样 + 射线法判定，支持多岛屿（MultiPolygon）和内环挖洞。

**确认弹窗会先探测周边再问。** 落点是纯几何随机的，只保证在边界内，不保证是人能去的地方 —— 郊区随机点落在农田、鱼塘、高速中间很常见。所以弹窗先查一次附近有多少去处，半径 1km → 3km → 5km 逐级放大，荒了就明说，让你拿着真实信息决定要不要换一个。

**周边推荐分三个 tab**（吃饭 / 咖啡 / 逛街），点开哪个查哪个，本地缓存，点一条拉起微信内置地图导航。

---

## 跑起来

### 1. 补 `config.js`（必须，否则周边功能不可用）

```bash
cp apps/dart-map/config.example.js apps/dart-map/config.js
```

然后按 `config.example.js` 里的说明去 <https://lbs.qq.com> 申请 Key 填进去。

> `config.js` 在 `.gitignore` 里，不会被提交。没有这个文件不会白屏（代码有 try/catch 兜底），但地名和周边推荐都不可用。

### 2. 配 request 合法域名

微信公众平台 → 开发 → 开发设置 → 服务器域名 → request 合法域名加上：

```
https://apis.map.qq.com
```

开发者工具里可以先勾「不校验合法域名」跳过这步，**但真机必须配**。

### 3. 导入项目

1. 微信开发者工具 → 导入项目，目录选仓库根目录（含 `project.config.json` 那层）
2. 确认 `miniprogramRoot` 指向 `apps/dart-map/`
3. AppID 选「测试号」，或换成你自己的
4. 编译

> 基础库 2.32.3。飞镖特效层依赖 map 组件的**同层渲染**（Android 2.7.0+ / iOS 2.9.0+），模拟器和真机表现不一致，**以真机为准**。

---

## 仓库结构

单仓多小程序，`project.config.json` 的 `miniprogramRoot` 决定开发者工具打开哪一个。

```
project.config.json          miniprogramRoot 控制当前打开的小程序
apps/
  dart-map/                  主应用
    app.js / app.json / app.wxss
    config.example.js        腾讯位置服务 Key 模板（config.js 被 gitignore）
    utils/lbs.js             位置服务适配层 ★
    assets/geo/
      regions.js             区域注册表，加区域改这一个文件
      310000.js              上海市    (province, ~130km 跨度)
      310118.js              青浦区    (district)
      310118109.js           华新镇    (town)
    assets/images/           dart-pin.png（home_bg.jpg 缺失，见已知问题）
    assets/audio/            空（bgm.mp3 / dart_hit.mp3 缺失）
    pages/index/             区域选择
    pages/game/              核心玩法
  test-app/                  占位小程序，仅验证多项目切换方案
```

### `utils/lbs.js` —— 位置服务适配层

页面**不直接调用任何服务商的 API**，全部走这一层：

```js
{
  provider: "tencent",       // MOCK_LBS 打开时是 "mock"
  supportsRating: false,     // 腾讯不给评分
  isMock: false,
  hasKey(),
  reverseGeocode(point)      // -> Promise<{ ok, address, reason }>
  searchNearby(point, opts)  // -> Promise<{ ok, count, list, message }>
  clearCache()               // 清掉 Storage 里的周边缓存
}
```

`searchNearby` 同时返回 `count` 和 `list`，就是为了让探测和列表复用一次请求 —— 地点搜索每天只有 200 次。

`searchNearby` 返回的每项都带 `rating` / `cost` 字段，腾讯实现下恒为 `null` —— 这是给换服务商预留的接缝。详见 [高德接入方案.md](高德接入方案.md)。

---

## 关键实现

| 位置 | 说明 |
|---|---|
| `game.js` `sampleByPower` | 力度 → 距中心归一化环带，容差 0.12 → 0.22 → 0.4 → 无约束逐级放宽 |
| `game.js` `pointInRing` 等 | 射线法点在多边形内判定，支持 MultiPolygon + 内环 |
| `game.js` `scaleForSpanKm` | 按区域实际跨度算初始 scale（上海 7 / 青浦 8 / 华新 11），不写死 |
| `game.js` `_probe` | 半径逐级放大探测，决定确认弹窗那句话的内容 |
| `game.wxss` `.power-fill` | 力度条是纯 CSS `linear + alternate`，蓄力期间**零 setData** |
| `game.js` `_readPower` | 按 `elapsed` 反解动画进度。**必须用 `linear`** —— 只有动画进度等于时间进度，算出的力度才等于屏幕上看到的位置 |

### 改动画时序要成对改

`game.js` 顶部的常量和 `game.wxss` 的 `animation-duration` 必须一致：

| 常量 | 值 | 对应 |
|---|---|---|
| `FLY_MS` | 680 | `dart-fly` / `ch-lock` |
| `SHAKE_MS` | 320 | `map-shake` |
| `IMPACT_MS` | 960 | `shock-out` (820) + delay (120) |
| `POWER_SWING_MS` | 1200 | `power-swing` |

### API 配额（重要）

腾讯位置服务**个人开发者**的额度极不对称：

| 接口 | 每日额度 | 每次投掷消耗 |
|---|---|---|
| 逆地址解析 | 6000 | 1 |
| **地点搜索** | **200** ← 瓶颈 | **1～3** |

地点搜索只有 200 次/日，是整个应用的天花板。为此做了三件事：

1. **探测与默认 tab 复用同一次请求** —— 探测荒不荒用的 `keyword=美食` 和「吃饭」tab 完全一样，所以 `searchNearby` 一次返回 `count` + `list`，确认后直接用缓存渲染，不再发第二次
2. **探测起步半径按落点远近跳档** —— 市区从 1km 起，远郊直接从 5km 起。原来远郊必然连探 1→3→5 三档，白烧两次
3. **结果按 ~100m 网格缓存进 Storage**（7 天）—— 同一片区域反复投掷不重复请求

实测每投消耗：只看默认 tab **1 次**，三个 tab 都看 **3 次**。按 200/日 折算约 **66～200 次投掷**。

`status` 码处理：`121` = 每日超限（明确提示额度）、`120` = 每秒超限（自动隔 1.1 秒重试 2 次）、`110/111/112/190/199` 各有对应文案，且都带上原始 `message` 便于排查。

> 企业认证后地点搜索提升到 **50 万/日**。个人开发者做原型够用，要上线建议认证。

### 配额烧光了怎么继续开发

`config.js` 里打开 mock 开关，全程假数据，一次请求都不发：

```js
module.exports = {
  TENCENT_MAP_KEY: "...",
  MOCK_LBS: true,   // 周边和地名走本地假数据
};
```

---

## 已知问题

### 阻断级

| 问题 | 说明 |
|---|---|
| `assets/images/home_bg.jpg` 缺失 | `index.wxml` 引用了它，但这文件**从未提交过**。首页现在只有黑色蒙层，没有背景图 |
| `assets/audio/*.mp3` 缺失 | `bgm.mp3` / `dart_hit.mp3` 都没有。已加 `onError` 兜底不会刷屏，但没有声音 |

### 安全（优先级最高）

**腾讯 Key 打包进客户端，反编译就能拿到，会被盗刷。** 加了周边搜索之后损失更大。两个选择，必须选一个：

- **最低限度**：腾讯位置服务控制台给 Key 绑 AppID / 域名白名单，设每日调用量上限
- **彻底方案**：用云函数或自己的服务端中转，Key 不下发到客户端，顺带还能加缓存省配额

### 一般

| 问题 | 说明 |
|---|---|
| `DEVNOTES.md` 完全过时 | 描述的是已删除的旧版本（Canvas + 摇杆 + 上传图片），里面三条 Bug 修复记录涉及的函数和样式类**全部已不存在**。**别照着它排查问题** |
| `.DS_Store` 已被跟踪 | 三个文件在首次提交就进库了，`.gitignore` 加晚了对已跟踪文件无效。`git rm --cached` 处理 |
| 首页同步加载全部 GeoJSON | `index.js` 模块顶层 require 了 `regions.js`，连带解析约 62KB JSON，只为拿三个区域名字。区域越多启动越慢，应拆成「名字表 + 几何懒加载」 |
| 音乐开关按钮被隐藏 | `game.wxml` 里 `wx:if="{{false}}"`，`toggleMusic` / `musicOn` / `.music-btn` 全是死代码。音频补齐后用户**没法关掉背景音乐** |
| 周边列表没有评分 | 腾讯地点搜索不返回该字段，不是 bug 是 API 限制。要评分见 [高德接入方案.md](高德接入方案.md) |
| 地点搜索额度只有 200/日 | 个人开发者的硬限制。已做复用 + 跳档 + Storage 缓存压到每投 1～3 次；要更多得企业认证 |
| `.eslintrc.js` 是摆设 | 没有 `extends`、`rules` 为空、`ecmaFeatures` 位置也写错了（应在 `parserOptions` 里）。而且没有 `package.json`，eslint 根本装不上 |
| `index.wxml` 有拖拽残留 | 「开始游戏」按钮上挂着 `style="position: relative; left: 0rpx; top: 2rpx"`，开发者工具误拖出来的 |
| 经纬度均匀采样 ≠ 面积均匀 | 上海纬度跨度约 1.2°，偏差可忽略。以后加省级 / 国家级区域才需要按 `asin` 修正 |
| `test-app` 的列表是假的 | 硬编码静态数组，点了没反应。它唯一的作用是验证 `miniprogramRoot` 切换有效，不是启动器 |

> 采样性能**不需要优化**。实测顶点数只有 383～1205（不是几千），单次点在多边形判定 0.003～0.004ms，凑满 3 个候选最慢 0.4ms。

---

## 待办

| 优先级 | 功能 |
|---|---|
| P1 | 历史记录（投掷过的地点列表 + 收藏） |
| P1 | 结果分享生成带标记的图片（文字分享已做） |
| P2 | 接高德拿评分（方案已写好） |
| P2 | 多人模式，轮流投掷 |
| P2 | 按可达性过滤（选「上海市」可能抽到崇明岛，实际当天到不了） |

---

## 加一个新区域

1. 下载行政区 GeoJSON（[DataV.GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector)），转成 `module.exports = {...}` 的 `.js` 放进 `assets/geo/`
2. 在 `assets/geo/regions.js` 里 require 进来，往 `REGIONS` 加一项 `{ id, geo }`

id 用 adcode，`name` 和 `center` 从 GeoJSON 的 `properties` 里自动读，不用手填。

> ⚠️ **坐标系必须是 GCJ-02。** 微信 `<map>` 和腾讯位置服务都用 GCJ-02，DataV 是阿里系（与高德同坐标系）所以现有三份数据是对的。
> 但 OpenStreetMap / Natural Earth / 政府开放数据 给的多半是 **WGS84**，在上海会整体偏移约 **500 米** —— 不报错、不崩溃、地图上看着也「差不多」，只是落点、地名、周边搜索全部系统性错位。换数据源前先确认坐标系。

## 加一个新小程序

1. `mkdir apps/新项目名/`，搭标准小程序结构
2. 改 `project.config.json`：
   ```json
   "miniprogramRoot": "apps/新项目名/",
   "srcMiniprogramRoot": "apps/新项目名/"
   ```
3. 开发者工具刷新项目

---

## 相关文档

| 文件 | 内容 |
|---|---|
| [项目分析.md](项目分析.md) | 完整的代码走查、问题分级、性能实测数据 |
| [高德接入方案.md](高德接入方案.md) | 接高德拿评分的完整方案：接口对照表、坑、改动清单、配额估算 |
| `DEVNOTES.md` | ⚠️ 已过时，描述的是旧版本，待重写 |

## License

MIT
