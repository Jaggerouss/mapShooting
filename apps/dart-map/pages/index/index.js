const DEFAULT_MAPS = [
  { label: "世界", src: "/assets/images/world-map.jpg" },
  { label: "中国", src: "/assets/images/china-map.jpg" },
  { label: "上海", src: "/assets/images/shanghai-map.jpg" },
  { label: "青浦", src: "/assets/images/qingpu-map.jpg" },
  { label: "华新", src: "/assets/images/huaxin-map.jpg" },
];

Page({
  data: {
    recentMaps: [],
    defaultMaps: DEFAULT_MAPS,
  },

  onShow() {
    const list = wx.getStorageSync("recentMaps") || [];
    this.setData({ recentMaps: list });
  },

  onStartGame() {
    wx.navigateTo({ url: "/pages/game/game" });
  },

  onUseRecentMap(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({
      url: `/pages/game/game?mapPath=${encodeURIComponent(path)}`,
    });
  },

  // 点预设地图，不存入最近使用
  onUseDefaultMap(e) {
    const src = e.currentTarget.dataset.src;
    wx.navigateTo({
      url: `/pages/game/game?mapPath=${encodeURIComponent(src)}&noCache=1`,
    });
  },
});
