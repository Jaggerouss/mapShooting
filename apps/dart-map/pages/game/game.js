const {
  getRegionById,
  DEFAULT_REGION_ID,
} = require("../../assets/geo/regions.js");

// 位置服务全部走适配层，页面不直接碰任何服务商的 API。
// 换服务商（比如接高德拿评分）只改 utils/lbs.js，这个文件不用动。
const lbs = require("../../utils/lbs.js");

// ---------------- 投掷动画时序（毫秒），需与 game.wxss 里的 animation 时长保持一致 ----------------
const FLY_MS = 680; // 飞镖飞行 = dart-fly / ch-lock
const SHAKE_MS = 320; // 命中抖屏 = map-shake
const IMPACT_MS = 960; // 冲击波扩散 = shock-out(820) + delay(120)

// 力度条来回摆动的半周期，必须与 wxss 里 .power-fill 的 animation-duration 一致。
// 用 linear 而非 ease，动画进度才等于时间进度，松手时才能按 elapsed 反推出屏幕上看到的力度。
const POWER_SWING_MS = 1200;
const POWER_MIN = 0.04;
const MIN_CHARGE_MS = 150; // 短于此视为误触

const CANDIDATE_COUNT = 3;
const KM_PER_DEG = 111.32;

// 落点是纯几何随机的——只保证在行政区边界内，不保证是人能去的地方。
// 郊区随机点落在农田、鱼塘、高速中间很常见，所以确认前先探一次周边，
// 半径逐级放大，让用户拿着真实信息去判断「行不行」。
const PROBE_RADII = [1000, 3000, 5000];
const PROBE_ENOUGH = 5; // 这一档找到这么多就不用再放大了

const NEARBY_TABS = [
  { key: "food", label: "吃饭", keyword: "美食" },
  { key: "cafe", label: "咖啡", keyword: "咖啡" },
  { key: "mall", label: "逛街", keyword: "商场" },
];

// ---------------- 点是否在行政区划边界内（射线法，支持多岛屿/挖洞） ----------------
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, polygon) {
  if (!pointInRing(lng, lat, polygon[0])) return false;
  for (let k = 1; k < polygon.length; k++) {
    if (pointInRing(lng, lat, polygon[k])) return false; // 落在挖空的洞里
  }
  return true;
}

function pointInMultiPolygon(lng, lat, multiPolygon) {
  for (let i = 0; i < multiPolygon.length; i++) {
    if (pointInPolygon(lng, lat, multiPolygon[i])) return true;
  }
  return false;
}

function computeBBox(multiPolygon) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  multiPolygon.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      });
    });
  });
  return { minLng, minLat, maxLng, maxLat };
}

// ---------------- 距离 / 方位 ----------------
// 等距圆柱近似：经度差按纬度做 cos 修正。上海这个尺度下的误差远小于「投飞镖」本身的语义精度。
function distanceKm(aLng, aLat, bLng, bLat) {
  const dx = (bLng - aLng) * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  const dy = bLat - aLat;
  return Math.sqrt(dx * dx + dy * dy) * KM_PER_DEG;
}

const DIRECTIONS = [
  "正北",
  "东北",
  "正东",
  "东南",
  "正南",
  "西南",
  "正西",
  "西北",
];

function bearingText(fromLng, fromLat, toLng, toLat) {
  const dx =
    (toLng - fromLng) * Math.cos((((fromLat + toLat) / 2) * Math.PI) / 180);
  const dy = toLat - fromLat;
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return DIRECTIONS[Math.round(deg / 45) % 8];
}

// 区域内离中心最远的顶点距离，用作力度环带的归一化基准
function computeMaxRadiusKm(multiPolygon, center) {
  let max = 0;
  multiPolygon.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach(([lng, lat]) => {
        const d = distanceKm(center.longitude, center.latitude, lng, lat);
        if (d > max) max = d;
      });
    });
  });
  return max || 1;
}

// 微信地图 scale 与视野宽度大致是 2 的幂关系：scale 16 约 400m，每降 1 级翻倍
function scaleForSpanKm(spanKm) {
  const span = Math.max(spanKm * 1.3, 0.2); // 留 30% 边距
  const scale = Math.round(16 - Math.log(span / 0.4) / Math.LN2);
  return Math.min(18, Math.max(4, scale));
}

// ---------------- 落点采样 ----------------
// 基础拒绝采样：bbox 内均匀撒点，射线法判断是否落在真实边界内
function sampleInRegion(multiPolygon, bbox, accept, maxTries) {
  const tries = maxTries || 400;
  for (let i = 0; i < tries; i++) {
    const lng = bbox.minLng + Math.random() * (bbox.maxLng - bbox.minLng);
    const lat = bbox.minLat + Math.random() * (bbox.maxLat - bbox.minLat);
    if (!pointInMultiPolygon(lng, lat, multiPolygon)) continue;
    if (accept && !accept(lng, lat)) continue;
    return { longitude: lng, latitude: lat };
  }
  return null;
}

// 力度 -> 距中心的归一化环带。力度小落市区，力度大落远郊。
function sampleByPower(ctx, power, tolerance) {
  const { multiPolygon, bbox, center, maxRadiusKm } = ctx;
  return sampleInRegion(multiPolygon, bbox, (lng, lat) => {
    const d =
      distanceKm(center.longitude, center.latitude, lng, lat) / maxRadiusKm;
    return Math.abs(d - power) <= tolerance;
  });
}

Page({
  data: {
    regionName: "",
    mapCenter: { longitude: 0, latitude: 0 },
    mapScale: 10,
    markers: [],

    // idle | charging | flying | picking | confirming | result
    phase: "idle",

    dartFlying: false,
    impact: false,
    shake: false,

    powerText: "",
    candidates: [],
    chosenIndex: -1,

    resultCollapsed: false,
    resultText: "",
    resultCoord: "",
    resultMeta: "",

    // 确认弹窗
    probeText: "",
    probeDone: false,

    // 周边推荐
    tabs: NEARBY_TABS,
    activeTab: "food",
    nearbyList: [],
    nearbyLoading: false,
    nearbyMessage: "",

    musicOn: true,
  },

  _bgmAudio: null,
  _sfxAudio: null,
  _regionCenter: null,
  _multiPolygon: null,
  _bbox: null,
  _maxRadiusKm: 1,
  _regionScale: 10,
  _timers: null,
  _chargeStart: 0,
  _chosen: null,
  _probeRadius: PROBE_RADII[0],
  _nearbyCache: null,

  onLoad(options) {
    this._timers = [];
    this._nearbyCache = {};

    const regionId = (options && options.regionId) || DEFAULT_REGION_ID;
    const region = getRegionById(regionId);
    const feature = region.geo.features[0];
    const regionName = feature.properties.name;
    const regionCenter = {
      longitude: feature.properties.center[0],
      latitude: feature.properties.center[1],
    };
    const multiPolygon = feature.geometry.coordinates;
    const bbox = computeBBox(multiPolygon);

    this._regionCenter = regionCenter;
    this._multiPolygon = multiPolygon;
    this._bbox = bbox;
    this._maxRadiusKm = computeMaxRadiusKm(multiPolygon, regionCenter);

    // 区域大小差异很大（上海市 ~130km 跨度，华新镇 ~8km），初始视野按实际跨度算。
    // 写死一个 scale 会让镇级看不清、市级看不全。
    // 取宽高的较长边而不是对角线——对角线会高估最多 40%，导致初始镜头拉得过远。
    const midLat = (bbox.minLat + bbox.maxLat) / 2;
    const midLng = (bbox.minLng + bbox.maxLng) / 2;
    const widthKm = distanceKm(bbox.minLng, midLat, bbox.maxLng, midLat);
    const heightKm = distanceKm(midLng, bbox.minLat, midLng, bbox.maxLat);
    this._regionScale = scaleForSpanKm(Math.max(widthKm, heightKm));

    this.setData({
      regionName,
      mapCenter: regionCenter,
      mapScale: this._regionScale,
    });

    this.initAudio();
  },

  onMapError(e) {
    console.error("map error", e.detail);
    wx.showToast({ title: "地图加载失败，请重试", icon: "none" });
  },

  onMapAbilityFail(e) {
    console.error("map ability fail", e.detail);
  },

  onUnload() {
    this._clearTimers();
    if (this._bgmAudio) this._bgmAudio.destroy();
    if (this._sfxAudio) this._sfxAudio.destroy();
  },

  // ---------------- 动画定时器管理 ----------------
  _later(fn, ms) {
    this._timers.push(setTimeout(fn, ms));
  },

  _clearTimers() {
    if (!this._timers) return;
    this._timers.forEach(clearTimeout);
    this._timers = [];
  },

  // ---------------- 背景音乐 ----------------
  initAudio() {
    const bgm = wx.createInnerAudioContext();
    bgm.src = "/assets/audio/bgm.mp3";
    bgm.loop = true;
    bgm.volume = 0.5;
    bgm.onError((err) => {
      // 音频文件缺失时不该刷屏，也不该影响玩法
      console.warn("bgm audio error (ignorable)", err);
    });
    bgm.play();
    this._bgmAudio = bgm;

    const sfx = wx.createInnerAudioContext();
    sfx.src = "/assets/audio/dart_hit.mp3";
    sfx.onError((err) => {
      // play()/pause() 快速连续调用时内核会报 DOMException，无害，静默忽略
      console.warn("sfx audio error (ignorable)", err);
    });
    this._sfxAudio = sfx;
  },

  toggleMusic() {
    const on = !this.data.musicOn;
    this.setData({ musicOn: on });
    if (on) {
      this._bgmAudio.play();
    } else {
      this._bgmAudio.pause();
    }
  },

  // ---------------- 蓄力 ----------------
  // 力度条是纯 CSS 动画（linear + alternate），蓄力期间不做任何 setData。
  // 松手时按 elapsed 反推力度 —— 屏幕上看到多少，算出来就是多少。
  onChargeStart() {
    if (this.data.phase !== "idle") return;
    this._chargeStart = Date.now();
    this.setData({
      phase: "charging",
      candidates: [],
      chosenIndex: -1,
      markers: [],
      mapCenter: this._regionCenter,
      mapScale: this._regionScale,
    });
  },

  onChargeCancel() {
    if (this.data.phase !== "charging") return;
    this.setData({ phase: "idle" });
  },

  onChargeEnd() {
    if (this.data.phase !== "charging") return;

    const elapsed = Date.now() - this._chargeStart;
    if (elapsed < MIN_CHARGE_MS) {
      this.setData({ phase: "idle" });
      wx.showToast({ title: "按住蓄力，松手投掷", icon: "none" });
      return;
    }

    const power = this._readPower(elapsed);
    const candidates = this._pickCandidates(power);
    if (!candidates.length) {
      this.setData({ phase: "idle" });
      wx.showToast({ title: "没找到合适的落点，再试一次", icon: "none" });
      return;
    }

    this._launch(power, candidates);
  },

  // 反解 CSS alternate 动画的当前进度：一个完整来回是 2 * POWER_SWING_MS
  _readPower(elapsed) {
    const cycle = POWER_SWING_MS * 2;
    const t = elapsed % cycle;
    const p =
      t < POWER_SWING_MS ? t / POWER_SWING_MS : (cycle - t) / POWER_SWING_MS;
    return POWER_MIN + p * (1 - POWER_MIN);
  },

  _pickCandidates(power) {
    const ctx = {
      multiPolygon: this._multiPolygon,
      bbox: this._bbox,
      center: this._regionCenter,
      maxRadiusKm: this._maxRadiusKm,
    };
    // 候选之间至少隔开一点，否则三个点挤在一起就没得选了
    const minGapKm = this._maxRadiusKm * 0.06;
    const picked = [];

    // 环带太窄可能采不满，逐级放宽；最后一档 1 等于不约束，保证一定有结果
    const tolerances = [0.12, 0.22, 0.4, 1];
    for (
      let ti = 0;
      ti < tolerances.length && picked.length < CANDIDATE_COUNT;
      ti++
    ) {
      let guard = 0;
      while (picked.length < CANDIDATE_COUNT && guard < 12) {
        guard++;
        const p = sampleByPower(ctx, power, tolerances[ti]);
        if (!p) break;
        const tooClose = picked.some(
          (q) =>
            distanceKm(q.longitude, q.latitude, p.longitude, p.latitude) <
            minGapKm
        );
        if (!tooClose) picked.push(p);
      }
    }

    return picked.map((p, i) => {
      const km = distanceKm(
        this._regionCenter.longitude,
        this._regionCenter.latitude,
        p.longitude,
        p.latitude
      );
      return {
        index: i,
        label: String(i + 1),
        longitude: p.longitude,
        latitude: p.latitude,
        distText:
          km < 1 ? Math.round(km * 1000) + " 米" : km.toFixed(1) + " 公里",
        dirText: bearingText(
          this._regionCenter.longitude,
          this._regionCenter.latitude,
          p.longitude,
          p.latitude
        ),
      };
    });
  },

  // t=0 起飞。镜头移到候选质心，飞镖朝容器正中飞 ——
  // 特效层的终点因此可以写死在中心，无需经纬度到屏幕像素的换算。
  _launch(power, candidates) {
    this._clearTimers();

    const centroid = this._centroidOf(candidates);
    const spanKm = this._spanOf(candidates);

    this.setData({
      phase: "flying",
      powerText: "力度 " + Math.round(power * 100) + "%",
      candidates,
      chosenIndex: -1,
      markers: [],
      dartFlying: true,
      impact: false,
      shake: false,
      mapCenter: centroid,
      mapScale: this._regionScale,
    });

    this._later(() => this._onDartHit(candidates, centroid, spanKm), FLY_MS);
  },

  _centroidOf(list) {
    const n = list.length;
    return {
      longitude: list.reduce((s, p) => s + p.longitude, 0) / n,
      latitude: list.reduce((s, p) => s + p.latitude, 0) / n,
    };
  },

  _spanOf(list) {
    let max = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = distanceKm(
          list[i].longitude,
          list[i].latitude,
          list[j].longitude,
          list[j].latitude
        );
        if (d > max) max = d;
      }
    }
    return max;
  },

  // t=FLY_MS 命中：一镖入地，震出三个候选
  _onDartHit(candidates, centroid, spanKm) {
    this.setData({
      phase: "picking",
      dartFlying: false,
      impact: true,
      shake: true,
      mapCenter: centroid,
      mapScale: scaleForSpanKm(spanKm),
      markers: candidates.map((c) => this._markerOf(c, false)),
    });

    wx.vibrateShort({ type: "medium" });
    if (this._sfxAudio) {
      this._sfxAudio.seek(0);
      this._sfxAudio.play();
    }

    // 动画播完后卸掉特效层，避免常驻的空 view
    this._later(() => this.setData({ shake: false }), SHAKE_MS);
    this._later(() => this.setData({ impact: false }), IMPACT_MS);
  },

  _markerOf(candidate, chosen) {
    return {
      id: candidate.index + 1,
      longitude: candidate.longitude,
      latitude: candidate.latitude,
      width: chosen ? 48 : 36,
      height: chosen ? 48 : 36,
      iconPath: "/assets/images/dart-pin.png",
      callout: {
        content: chosen
          ? "就是这里！"
          : candidate.label + " · " + candidate.distText,
        display: "ALWAYS",
        fontSize: chosen ? 13 : 11,
        borderRadius: 8,
        padding: chosen ? 8 : 6,
        bgColor: chosen ? "#e24b4a" : "#ffffff",
        color: chosen ? "#ffffff" : "#333333",
      },
    };
  },

  // ---------------- 三选一 ----------------
  onPickCandidate(e) {
    this._choose(Number(e.currentTarget.dataset.index));
  },

  onMarkerTap(e) {
    if (this.data.phase !== "picking") return;
    this._choose(Number(e.detail.markerId) - 1);
  },

  _choose(index) {
    if (this.data.phase !== "picking") return;
    const candidate = this.data.candidates[index];
    if (!candidate) return;

    this._chosen = candidate;
    this._nearbyCache = {};

    wx.vibrateShort({ type: "light" });
    this.setData({
      phase: "confirming",
      chosenIndex: index,
      probeText: "",
      probeDone: false,
      resultCollapsed: false,
      resultText: "正在查询地名...",
      resultCoord:
        "经度 " +
        candidate.longitude.toFixed(6) +
        "，纬度 " +
        candidate.latitude.toFixed(6),
      resultMeta:
        this.data.powerText +
        " · 距中心 " +
        candidate.distText +
        candidate.dirText,
      mapCenter: {
        longitude: candidate.longitude,
        latitude: candidate.latitude,
      },
      mapScale: 14,
      markers: [this._markerOf(candidate, true)],
    });

    // 地名和周边探测并行发出，谁先回来先渲染谁
    lbs.reverseGeocode(candidate).then((res) => {
      if (this._chosen !== candidate) return; // 用户已经换了一个
      this.setData({ resultText: res.address });
    });

    this._probe(candidate);
  },

  // 半径逐级放大，直到找到足够多的去处。
  // 这一步决定了确认弹窗里那句话有没有信息量——光报个地名，用户判断不了行不行。
  _probe(candidate) {
    if (!lbs.hasKey()) {
      this.setData({
        probeDone: true,
        probeText: "没配 Key，看不了周边（见 config.js）",
      });
      return;
    }

    const step = (i) => {
      if (i >= PROBE_RADII.length) {
        this._probeRadius = PROBE_RADII[PROBE_RADII.length - 1];
        this.setData({
          probeDone: true,
          probeText: "方圆 5 公里几乎没什么去处，这一镖有点荒",
        });
        return;
      }

      const radius = PROBE_RADII[i];
      lbs.countNearby(candidate, { keyword: "美食", radius }).then((res) => {
        if (this._chosen !== candidate) return;

        if (!res.ok) {
          this._probeRadius = radius;
          this.setData({
            probeDone: true,
            probeText: res.message || "周边查询失败，仍可继续",
          });
          return;
        }

        if (res.count >= PROBE_ENOUGH || i === PROBE_RADII.length - 1) {
          this._probeRadius = radius;
          const km = radius / 1000;
          this.setData({
            probeDone: true,
            probeText:
              res.count > 0
                ? km + " 公里内有 " + res.count + " 个去处"
                : km + " 公里内没找到什么，这一镖有点荒",
          });
          return;
        }

        // 这一档太少，放大再探
        this.setData({
          probeText: radius / 1000 + " 公里内只有 " + res.count + " 个，再找远一点...",
        });
        step(i + 1);
      });
    };

    this.setData({ probeText: "正在看看附近有什么..." });
    step(0);
  },

  // 不满意：退回三选一，三个候选重新亮出来
  onRejectSpot() {
    if (this.data.phase !== "confirming") return;
    this._chosen = null;
    const candidates = this.data.candidates;
    this.setData({
      phase: "picking",
      chosenIndex: -1,
      probeText: "",
      probeDone: false,
      mapCenter: this._centroidOf(candidates),
      mapScale: scaleForSpanKm(this._spanOf(candidates)),
      markers: candidates.map((c) => this._markerOf(c, false)),
    });
  },

  onConfirmSpot() {
    if (this.data.phase !== "confirming") return;
    this.setData({ phase: "result" });
    this._loadNearby(this.data.activeTab);
  },

  // ---------------- 周边推荐 ----------------
  onSwitchTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeTab) return;
    this.setData({ activeTab: key });
    this._loadNearby(key);
  },

  // 按 tab 懒加载并缓存。一次投掷常见路径是 逆地理 1 次 + 探测 1~3 次 + 每开一个 tab 1 次，
  // 三个 tab 一次性全拉会平白多烧两次配额。
  _loadNearby(key) {
    const candidate = this._chosen;
    if (!candidate) return;

    const cached = this._nearbyCache[key];
    if (cached) {
      this.setData({
        nearbyList: cached.list,
        nearbyMessage: cached.message,
        nearbyLoading: false,
      });
      return;
    }

    const tab = NEARBY_TABS.filter((t) => t.key === key)[0];
    if (!tab) return;

    this.setData({ nearbyLoading: true, nearbyList: [], nearbyMessage: "" });

    lbs
      .searchNearby(candidate, {
        keyword: tab.keyword,
        radius: this._probeRadius,
        limit: 20,
      })
      .then((res) => {
        if (this._chosen !== candidate || this.data.activeTab !== key) return;

        let message = "";
        if (!res.ok) {
          message =
            res.reason === "nokey"
              ? "配置腾讯位置服务 Key 后（见 config.js）可显示周边"
              : res.message || "周边查询失败";
        } else if (!res.list.length) {
          message = "这附近没有" + tab.label + "的去处";
        }

        this._nearbyCache[key] = { list: res.list, message };
        this.setData({
          nearbyLoading: false,
          nearbyList: res.list,
          nearbyMessage: message,
        });
      });
  },

  // 拉起微信内置地图查看/导航
  onOpenPoi(e) {
    const index = Number(e.currentTarget.dataset.index);
    const poi = this.data.nearbyList[index];
    if (!poi || !poi.latitude || !poi.longitude) return;
    wx.openLocation({
      latitude: poi.latitude,
      longitude: poi.longitude,
      name: poi.name,
      address: poi.address,
      scale: 18,
    });
  },


  throwAgain() {
    this._clearTimers();
    this._chosen = null;
    this._nearbyCache = {};
    this._probeRadius = PROBE_RADII[0];
    this.setData({
      phase: "idle",
      dartFlying: false,
      impact: false,
      shake: false,
      candidates: [],
      chosenIndex: -1,
      powerText: "",
      resultText: "",
      resultCoord: "",
      resultMeta: "",
      probeText: "",
      probeDone: false,
      activeTab: "food",
      nearbyList: [],
      nearbyLoading: false,
      nearbyMessage: "",
      mapCenter: this._regionCenter,
      mapScale: this._regionScale,
      markers: [],
    });
  },

  toggleResultCard() {
    this.setData({ resultCollapsed: !this.data.resultCollapsed });
  },
});
