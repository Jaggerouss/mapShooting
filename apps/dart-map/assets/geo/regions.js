// 可选区域注册表：新增区域时，1) 下载 geojson 转成 .js 放这个目录
// 2) require 进来 3) 在 REGIONS 里加一项 { id, geo }
//
// ⚠️ 坐标系必须是 GCJ-02（火星坐标）。
// 微信 <map> 组件和腾讯位置服务都用 GCJ-02，现有三份数据来自 DataV.GeoAtlas
// （阿里系，与高德同坐标系）所以是对的 —— 上海的 center [121.472644, 31.231706]
// 正是高德的上海市中心坐标。
//
// 但从 OpenStreetMap / Natural Earth / 政府开放数据 拿到的多半是 WGS84，
// 在上海会整体偏移约 500 米。这个错误不报警、不崩溃、地图上看着也「差不多」，
// 只是落点、地名、周边搜索全部系统性错位。换数据源前先确认坐标系。
const shanghai = require("./310000.js");
const qingpu = require("./310118.js");
const huaxin = require("./310118109.js");

const REGIONS = [
  { id: "310000", geo: shanghai },
  { id: "310118", geo: qingpu },
  { id: "310118109", geo: huaxin },
];

const DEFAULT_REGION_ID = REGIONS[0].id;

function getRegionList() {
  return REGIONS.map((r) => ({
    id: r.id,
    name: r.geo.features[0].properties.name,
  }));
}

function getRegionById(id) {
  return REGIONS.find((r) => r.id === id) || REGIONS[0];
}

module.exports = { REGIONS, DEFAULT_REGION_ID, getRegionList, getRegionById };
