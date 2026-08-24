const {
  getRegionList,
  getRegionById,
  DEFAULT_REGION_ID,
} = require("../../assets/geo/regions.js");
const visited = require("../../utils/visited.js");

const regionList = getRegionList();
const defaultIndex = regionList.findIndex((r) => r.id === DEFAULT_REGION_ID);

// 「最远不超过」：把力度环带的上限交给用户。
// 选「不限」时用区域本身的最远点 —— 也就是原来的行为。
// 这一条是给「选上海市结果抽到崇明岛，当天根本去不了」兜底的。
const MAX_KM_OPTIONS = [
  { label: "不限", value: 0 },
  { label: "5 公里内", value: 5 },
  { label: "10 公里内", value: 10 },
  { label: "20 公里内", value: 20 },
  { label: "50 公里内", value: 50 },
];

// 点在多边形内（探索度要用）。几何实现和 game.js 一致。
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
    if (pointInRing(lng, lat, polygon[k])) return false;
  }
  return true;
}

function pointInMultiPolygon(lng, lat, multiPolygon) {
  for (let i = 0; i < multiPolygon.length; i++) {
    if (pointInPolygon(lng, lat, multiPolygon[i])) return true;
  }
  return false;
}

function bboxOf(multiPolygon) {
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

Page({
  data: {
    regionList,
    regionIndex: defaultIndex >= 0 ? defaultIndex : 0,
    maxKmOptions: MAX_KM_OPTIONS,
    maxKmIndex: 0,
    explored: null,
  },

  onShow() {
    // 从游戏页返回时探索度可能变了，每次显示都刷新
    this._refreshExplored();
  },

  onRegionChange(e) {
    this.setData({ regionIndex: Number(e.detail.value) }, () =>
      this._refreshExplored()
    );
  },

  onMaxKmChange(e) {
    this.setData({ maxKmIndex: Number(e.detail.value) });
  },

  _refreshExplored() {
    const region = this.data.regionList[this.data.regionIndex];
    if (!region) return;
    const feature = getRegionById(region.id).geo.features[0];
    const multiPolygon = feature.geometry.coordinates;
    const stats = visited.stats(
      region.id,
      { bbox: bboxOf(multiPolygon), multiPolygon },
      pointInMultiPolygon
    );
    this.setData({ explored: stats });
  },

  onStartGame() {
    const region = this.data.regionList[this.data.regionIndex];
    const maxKm = this.data.maxKmOptions[this.data.maxKmIndex].value;
    wx.navigateTo({
      url:
        `/pages/game/game?regionId=${region.id}` +
        (maxKm ? `&maxKm=${maxKm}` : ""),
    });
  },

  onShareAppMessage() {
    return {
      title: "跟着 Jagger 去旅行 —— 投个飞镖决定去哪",
      path: "/pages/index/index",
    };
  },

  onShareTimeline() {
    return { title: "跟着 Jagger 去旅行 —— 投个飞镖决定去哪" };
  },
});
