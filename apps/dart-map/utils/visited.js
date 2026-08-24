// 探索记录：去过哪、探索了多少、下次少抽已经去过的地方。
//
// 全部存在本地 Storage，不碰任何 API。这是把「一次性玩具」变成
// 「越用越有价值」的关键 —— 应用记得你去过哪，随机才不会老在同一片打转。

const KEY = "visited:v1";
const KM_PER_DEG = 111.32;

// 网格边长。2km 的粒度：同一个镇算一格，隔壁镇算另一格。
// 太细则永远探索不完，太粗则相邻两次投掷会被判成同一个地方。
const CELL_KM = 2;

function distanceKm(aLng, aLat, bLng, bLat) {
  const dx = (bLng - aLng) * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  const dy = bLat - aLat;
  return Math.sqrt(dx * dx + dy * dy) * KM_PER_DEG;
}

// 经纬度 -> 网格 id。纬度方向固定，经度方向按纬度做 cos 修正，
// 这样高纬度地区的格子不会被压扁。
function cellIdOf(lng, lat) {
  const latStep = CELL_KM / KM_PER_DEG;
  const lngStep = latStep / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return Math.round(lat / latStep) + ":" + Math.round(lng / lngStep);
}

function readAll() {
  try {
    return wx.getStorageSync(KEY) || {};
  } catch (e) {
    return {};
  }
}

function writeAll(data) {
  try {
    wx.setStorageSync(KEY, data);
  } catch (e) {
    // Storage 满了不该影响玩法
    console.warn("visited write failed", e);
  }
}

function list(regionId) {
  const all = readAll();
  return (all[regionId] && all[regionId].points) || [];
}

// 确认「就这儿」时记一笔。went=false 表示只是抽中了，还没真去。
function add(regionId, point, meta) {
  const all = readAll();
  const bucket = all[regionId] || { points: [], cells: {} };
  const id = String(Date.now());
  const cell = cellIdOf(point.longitude, point.latitude);

  bucket.points.push({
    id,
    longitude: point.longitude,
    latitude: point.latitude,
    cell,
    name: (meta && meta.name) || "",
    distText: (meta && meta.distText) || "",
    dirText: (meta && meta.dirText) || "",
    ts: Date.now(),
    went: false,
  });
  bucket.cells[cell] = true;

  // 只留最近 300 条，够用且不会撑爆 Storage
  if (bucket.points.length > 300) bucket.points = bucket.points.slice(-300);

  all[regionId] = bucket;
  writeAll(all);
  return id;
}

// 回来之后补打卡「我真去了」
function markWent(regionId, id, went) {
  const all = readAll();
  const bucket = all[regionId];
  if (!bucket) return false;
  const p = bucket.points.filter((x) => x.id === id)[0];
  if (!p) return false;
  p.went = went === undefined ? true : !!went;
  writeAll(all);
  return true;
}

function visitedCells(regionId) {
  const all = readAll();
  return (all[regionId] && all[regionId].cells) || {};
}

// 这个点所在的格子去过没有
function isVisited(regionId, lng, lat) {
  return !!visitedCells(regionId)[cellIdOf(lng, lat)];
}

// 区域内一共有多少格。要遍历网格做点在多边形判定，算一次就缓存。
const CELL_TOTAL_KEY = "visited:cellTotal:v1";

function totalCells(regionId, ctx, pointInMultiPolygon) {
  let cache = {};
  try {
    cache = wx.getStorageSync(CELL_TOTAL_KEY) || {};
  } catch (e) {}
  if (cache[regionId]) return cache[regionId];

  const { bbox, multiPolygon } = ctx;
  const latStep = CELL_KM / KM_PER_DEG;
  let n = 0;
  for (let lat = bbox.minLat; lat <= bbox.maxLat; lat += latStep) {
    const lngStep = latStep / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    for (let lng = bbox.minLng; lng <= bbox.maxLng; lng += lngStep) {
      if (pointInMultiPolygon(lng, lat, multiPolygon)) n++;
    }
  }
  n = Math.max(1, n);

  cache[regionId] = n;
  try {
    wx.setStorageSync(CELL_TOTAL_KEY, cache);
  } catch (e) {}
  return n;
}

function stats(regionId, ctx, pointInMultiPolygon) {
  const cells = visitedCells(regionId);
  const visited = Object.keys(cells).length;
  const total = totalCells(regionId, ctx, pointInMultiPolygon);
  const points = list(regionId);
  return {
    visited,
    total,
    percent: Math.min(100, Math.round((visited / total) * 100)),
    picked: points.length,
    went: points.filter((p) => p.went).length,
  };
}

function clear(regionId) {
  const all = readAll();
  if (regionId) delete all[regionId];
  writeAll(regionId ? all : {});
  try {
    wx.removeStorageSync(CELL_TOTAL_KEY);
  } catch (e) {}
}

module.exports = {
  CELL_KM,
  cellIdOf,
  distanceKm,
  list,
  add,
  markWent,
  isVisited,
  visitedCells,
  stats,
  clear,
};
