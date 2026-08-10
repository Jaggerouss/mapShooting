// 可选区域注册表：新增区域时，1) 下载 geojson 转成 .js 放这个目录
// 2) require 进来 3) 在 REGIONS 里加一项 { id, geo }
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
