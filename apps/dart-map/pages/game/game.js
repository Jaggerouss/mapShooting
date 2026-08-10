const {
  getRegionById,
  DEFAULT_REGION_ID,
} = require("../../assets/geo/regions.js");
const { TENCENT_MAP_KEY } = require("../../config.js");

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

// 在边界外接矩形内做拒绝采样，直到落在真实边界内
function randomPointInRegion(multiPolygon, bbox, maxTries) {
  const tries = maxTries || 500;
  for (let i = 0; i < tries; i++) {
    const lng = bbox.minLng + Math.random() * (bbox.maxLng - bbox.minLng);
    const lat = bbox.minLat + Math.random() * (bbox.maxLat - bbox.minLat);
    if (pointInMultiPolygon(lng, lat, multiPolygon)) {
      return { longitude: lng, latitude: lat };
    }
  }
  return null;
}

Page({
  data: {
    regionName: "",
    mapCenter: { longitude: 0, latitude: 0 },
    mapScale: 10,
    markers: [],
    throwing: false,
    showResult: false,
    resultCollapsed: false,
    resultText: "",
    resultCoord: "",
    musicOn: true,
  },

  _bgmAudio: null,
  _sfxAudio: null,
  _regionCenter: null,
  _multiPolygon: null,
  _bbox: null,

  onLoad(options) {
    const regionId = (options && options.regionId) || DEFAULT_REGION_ID;
    const region = getRegionById(regionId);
    const feature = region.geo.features[0];
    const regionName = feature.properties.name;
    const regionCenter = {
      longitude: feature.properties.center[0],
      latitude: feature.properties.center[1],
    };
    const multiPolygon = feature.geometry.coordinates;

    this._regionCenter = regionCenter;
    this._multiPolygon = multiPolygon;
    this._bbox = computeBBox(multiPolygon);

    this.setData({
      regionName,
      mapCenter: regionCenter,
      mapScale: 10,
    });

    this.initAudio();
  },

  onMapError(e) {
    console.error("map error", e.detail);
    wx.showModal({
      title: "地图组件报错",
      content: JSON.stringify(e.detail),
      showCancel: false,
    });
  },

  onMapAbilityFail(e) {
    console.error("map ability fail", e.detail);
    wx.showModal({
      title: "地图能力失败",
      content: JSON.stringify(e.detail),
      showCancel: false,
    });
  },

  onMapUpdated() {
    console.log("map updated ok");
  },

  onUnload() {
    if (this._bgmAudio) this._bgmAudio.destroy();
    if (this._sfxAudio) this._sfxAudio.destroy();
  },

  // ---------------- 背景音乐 ----------------
  initAudio() {
    const bgm = wx.createInnerAudioContext();
    bgm.src = "/assets/audio/bgm.mp3";
    bgm.loop = true;
    bgm.volume = 0.5;
    bgm.play();
    this._bgmAudio = bgm;

    const sfx = wx.createInnerAudioContext();
    sfx.src = "/assets/audio/dart_hit.mp3";
    sfx.onError((err) => {
      // play()/pause() 快速连续调用时浏览器内核会报 DOMException，无害，静默忽略
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

  // ---------------- 投掷：在限定区域内生成随机坐标 ----------------
  throwDart() {
    if (this.data.throwing) return;

    const point = randomPointInRegion(this._multiPolygon, this._bbox);
    if (!point) {
      wx.showToast({ title: "没找到合适的落点，再试一次", icon: "none" });
      return;
    }

    this.setData({
      throwing: true,
      showResult: false,
      resultCollapsed: false,
      mapCenter: point,
      mapScale: 14,
      markers: [
        {
          id: 1,
          longitude: point.longitude,
          latitude: point.latitude,
          width: 44,
          height: 44,
          iconPath: "/assets/images/dart-pin.png",
          callout: {
            content: "就是这里！",
            display: "ALWAYS",
            fontSize: 13,
            borderRadius: 8,
            padding: 8,
            bgColor: "#e24b4a",
            color: "#fff",
          },
        },
      ],
    });

    wx.vibrateShort({ type: "medium" });
    if (this._sfxAudio) {
      this._sfxAudio.seek(0);
      this._sfxAudio.play();
    }

    this.reverseGeocode(point);
  },

  // ---------------- 坐标 -> 地名（腾讯位置服务逆地理编码） ----------------
  reverseGeocode(point) {
    const coordText = `经度 ${point.longitude.toFixed(6)}，纬度 ${point.latitude.toFixed(6)}`;

    if (!TENCENT_MAP_KEY) {
      this.setData({
        throwing: false,
        showResult: true,
        resultCollapsed: false,
        resultText:
          "坐标已生成。配置腾讯位置服务 Key 后（见 config.js）可自动显示具体地名",
        resultCoord: coordText,
      });
      return;
    }

    wx.request({
      url: "https://apis.map.qq.com/ws/geocoder/v1/",
      data: {
        location: `${point.latitude},${point.longitude}`,
        key: TENCENT_MAP_KEY,
      },
      success: (res) => {
        const data = res.data;
        console.log("reverseGeocode raw response:", JSON.stringify(data));
        let text = "未能获取到具体地址";
        if (data && data.status === 0 && data.result) {
          text =
            data.result.address ||
            (data.result.formatted_addresses &&
              data.result.formatted_addresses.recommend) ||
            text;
        } else if (data && data.status === 121) {
          text = "坐标已生成。今日地名查询次数已用完，明天再来查看地名吧～";
        } else if (data) {
          text = `未能获取到具体地址（status=${data.status}, message=${data.message}）`;
        }
        this.setData({
          throwing: false,
          showResult: true,
          resultCollapsed: false,
          resultText: text,
          resultCoord: coordText,
        });
      },
      fail: () => {
        this.setData({
          throwing: false,
          showResult: true,
          resultCollapsed: false,
          resultText:
            "地址查询失败，检查网络或小程序后台的 request 合法域名配置",
          resultCoord: coordText,
        });
      },
    });
  },

  throwAgain() {
    this.setData({
      showResult: false,
      mapCenter: this._regionCenter,
      mapScale: 10,
      markers: [],
    });
  },

  toggleResultCard() {
    this.setData({ resultCollapsed: !this.data.resultCollapsed });
  },

  noop() {},
});
