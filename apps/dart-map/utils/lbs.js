// 位置服务适配层。
//
// 对外暴露三个与服务商无关的方法，页面只认这个接口：
//   reverseGeocode(point)          -> Promise<{ address, ok, reason }>
//   countNearby(point, opts)       -> Promise<{ count, ok, reason }>
//   searchNearby(point, opts)      -> Promise<{ list, ok, reason }>
//
// 当前实现是腾讯位置服务。腾讯的地点搜索不返回评分，所以 list 里的
// rating / cost 恒为 null —— 这两个字段是给高德预留的接缝，
// 换服务商时只需另写一个同接口的模块，game.js 一行不用改。
// 详见仓库根目录的《高德接入方案.md》。

let TENCENT_MAP_KEY = "";
try {
  TENCENT_MAP_KEY = require("../config.js").TENCENT_MAP_KEY || "";
} catch (e) {
  // config.js 在 .gitignore 里，新克隆的仓库没有这个文件。
  // 静默降级，调用方通过 ok:false / reason:'nokey' 得知。
}

const HOST = "https://apis.map.qq.com";

function hasKey() {
  return !!TENCENT_MAP_KEY;
}

function request(url, data) {
  return new Promise((resolve) => {
    wx.request({
      url,
      data: Object.assign({ key: TENCENT_MAP_KEY }, data),
      success: (res) => resolve({ ok: true, data: res.data }),
      fail: (err) => resolve({ ok: false, err }),
    });
  });
}

// 把腾讯的 status 码翻译成页面能直接显示的文案
function explainStatus(data) {
  if (!data) return "返回内容为空";
  if (data.status === 121) return "今日查询次数已用完，明天再来～";
  if (data.status === 110) return "请求来源未被授权，检查 Key 的域名白名单";
  if (data.status === 111) return "签名校验失败";
  return "查询失败（status=" + data.status + "，" + (data.message || "") + "）";
}

function reverseGeocode(point) {
  if (!hasKey()) {
    return Promise.resolve({
      ok: false,
      reason: "nokey",
      address: "配置腾讯位置服务 Key 后（见 config.js）可自动显示具体地名",
    });
  }

  return request(HOST + "/ws/geocoder/v1/", {
    location: point.latitude + "," + point.longitude,
  }).then((res) => {
    if (!res.ok) {
      return {
        ok: false,
        reason: "network",
        address: "地址查询失败，检查网络或小程序后台的 request 合法域名配置",
      };
    }
    const data = res.data;
    if (data && data.status === 0 && data.result) {
      const address =
        data.result.address ||
        (data.result.formatted_addresses &&
          data.result.formatted_addresses.recommend) ||
        "未能获取到具体地址";
      return { ok: true, address };
    }
    return { ok: false, reason: "api", address: explainStatus(data) };
  });
}

// 只要总数，不要列表 —— page_size=1 让返回体尽量小。
// 用来判断落点周边荒不荒，决定要不要建议重投。
function countNearby(point, opts) {
  if (!hasKey()) return Promise.resolve({ ok: false, reason: "nokey", count: 0 });

  return request(HOST + "/ws/place/v1/search", {
    keyword: opts.keyword,
    boundary:
      "nearby(" + point.latitude + "," + point.longitude + "," + opts.radius + ")",
    page_size: 1,
    page_index: 1,
  }).then((res) => {
    if (!res.ok) return { ok: false, reason: "network", count: 0 };
    const data = res.data;
    if (data && data.status === 0) {
      return { ok: true, count: data.count || 0 };
    }
    return { ok: false, reason: "api", count: 0, message: explainStatus(data) };
  });
}

function searchNearby(point, opts) {
  if (!hasKey()) return Promise.resolve({ ok: false, reason: "nokey", list: [] });

  return request(HOST + "/ws/place/v1/search", {
    keyword: opts.keyword,
    boundary:
      "nearby(" + point.latitude + "," + point.longitude + "," + opts.radius + ")",
    orderby: "_distance",
    page_size: opts.limit || 20,
    page_index: 1,
  }).then((res) => {
    if (!res.ok) return { ok: false, reason: "network", list: [] };
    const data = res.data;
    if (!data || data.status !== 0) {
      return { ok: false, reason: "api", list: [], message: explainStatus(data) };
    }

    const list = (data.data || []).map((item) => {
      const m = item._distance || 0;
      return {
        id: item.id,
        name: item.title,
        address: item.address,
        // 腾讯的 category 形如「美食:咖啡厅」，只取最末一段更好读
        category: (item.category || "").split(":").pop(),
        distance: m,
        distanceText: m < 1000 ? Math.round(m) + "m" : (m / 1000).toFixed(1) + "km",
        latitude: item.location && item.location.lat,
        longitude: item.location && item.location.lng,
        // 腾讯不提供，恒为 null。接高德后这里才有值。
        rating: null,
        cost: null,
      };
    });
    return { ok: true, list };
  });
}

module.exports = {
  provider: "tencent",
  supportsRating: false,
  hasKey,
  reverseGeocode,
  countNearby,
  searchNearby,
};
