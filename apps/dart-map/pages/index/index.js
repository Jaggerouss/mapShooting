const {
  getRegionList,
  DEFAULT_REGION_ID,
} = require("../../assets/geo/regions.js");

const regionList = getRegionList();
const defaultIndex = regionList.findIndex((r) => r.id === DEFAULT_REGION_ID);

Page({
  data: {
    regionList,
    regionIndex: defaultIndex >= 0 ? defaultIndex : 0,
  },

  onRegionChange(e) {
    this.setData({ regionIndex: Number(e.detail.value) });
  },

  onStartGame() {
    const region = this.data.regionList[this.data.regionIndex];
    wx.navigateTo({ url: `/pages/game/game?regionId=${region.id}` });
  },
});
