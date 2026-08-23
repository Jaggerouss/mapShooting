// 位置服务适配层。
//
// 对外暴露的方法，页面只认这个接口：
//   reverseGeocode(point)      -> Promise<{ ok, address, reason }>
//   searchNearby(point, opts)  -> Promise<{ ok, count, list, reason, message }>
//
// 都承诺永不 reject、永不抛：失败一律降级成 { ok:false, reason, ... }。
//
// ⚠️ 配额极不对称（腾讯个人开发者）：
//     逆地址解析  6000 次/日
//     地点搜索     200 次/日   ← 瓶颈在这
// 所以 searchNearby 一次就把 count 和 list 都返回，探测和列表复用同一次请求；
// 并且结果按 ~100m 网格缓存进 Storage，同一片区域不重复请求。
//
// 当前实现是腾讯位置服务。腾讯的地点搜索不返回评分，所以 list 里的
// rating / cost 恒为 null —— 这两个字段是给高德预留的接缝。
// 详见仓库根目录的《高德接入方案.md》。

let TENCENT_MAP_KEY = "";
let MOCK_LBS = false;
try {
  const cfg = require("../config.js");
  TENCENT_MAP_KEY = cfg.TENCENT_MAP_KEY || "";
  MOCK_LBS = !!cfg.MOCK_LBS;
} catch (e) {
  // config.js 在 .gitignore 里，新克隆的仓库没有这个文件。
  // 静默降级，调用方通过 ok:false / reason:'nokey' 得知。
}

const HOST = "https://apis.map.qq.com";

// Storage 缓存：坐标取到小数点后 3 位 ≈ 100m 网格，同一片区域复用
const CACHE_PREFIX = "lbs:";
const CACHE_INDEX = "lbs:__index";
const CACHE_TTL = 7 * 24 * 3600 * 1000;
const CACHE_MAX = 80;

function hasKey() {
  return MOCK_LBS || !!TENCENT_MAP_KEY;
}

function cacheKey(kind, point, opts) {
  return (
    CACHE_PREFIX +
    kind +
    ":" +
    ((opts && opts.keyword) || "") +
    ":" +
    ((opts && opts.radius) || 0) +
    ":" +
    point.latitude.toFixed(3) +
    "," +
    point.longitude.toFixed(3)
  );
}

function cacheGet(key) {
  try {
    const hit = wx.getStorageSync(key);
    if (!hit || !hit.t) return null;
    if (Date.now() - hit.t > CACHE_TTL) {
      wx.removeStorageSync(key);
      return null;
    }
    return hit.v;
  } catch (e) {
    return null;
  }
}

function cacheSet(key, value) {
  try {
    wx.setStorageSync(key, { t: Date.now(), v: value });
    const index = wx.getStorageSync(CACHE_INDEX) || [];
    const pos = index.indexOf(key);
    if (pos >= 0) index.splice(pos, 1);
    index.push(key);
    // 超量就丢最早的，避免把用户的 Storage 撑爆
    while (index.length > CACHE_MAX) {
      const old = index.shift();
      try {
        wx.removeStorageSync(old);
      } catch (e) {}
    }
    wx.setStorageSync(CACHE_INDEX, index);
  } catch (e) {
    // Storage 满了或不可用，缓存失败不影响功能
  }
}

function clearCache() {
  try {
    const index = wx.getStorageSync(CACHE_INDEX) || [];
    index.forEach((k) => {
      try {
        wx.removeStorageSync(k);
      } catch (e) {}
    });
    wx.removeStorageSync(CACHE_INDEX);
  } catch (e) {}
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

// status 120 = 每秒请求量超限，是瞬时的，隔一秒重试就好。
// status 121 = 每日调用量超限，重试没有意义，直接返回。
function requestRetrying(url, data, retriesLeft) {
  return request(url, data).then((res) => {
    const left = retriesLeft === undefined ? 2 : retriesLeft;
    if (res.ok && res.data && res.data.status === 120 && left > 0) {
      return delay(1100).then(() => requestRetrying(url, data, left - 1));
    }
    return res;
  });
}

// 把腾讯的 status 码翻译成页面能直接显示的文案。
// 带上原始 message，否则出问题时无从排查。
function explainStatus(data, apiName) {
  if (!data) return "返回内容为空";
  const raw = data.message ? "（" + data.message + "）" : "";
  if (data.status === 121) {
    return (
      "今日「" + apiName + "」额度已用完（个人开发者地点搜索仅 200 次/日），明天再来～"
    );
  }
  if (data.status === 120) return "请求太频繁，稍后再试" + raw;
  if (data.status === 110) return "请求来源未被授权，检查 Key 的白名单设置" + raw;
  if (data.status === 111) return "签名校验失败" + raw;
  if (data.status === 112) return "IP 未被授权" + raw;
  if (data.status === 190) return "无效的 Key，检查 config.js" + raw;
  if (data.status === 199) return "这个 Key 没开启 WebServiceAPI 功能" + raw;
  return "查询失败（status=" + data.status + "）" + raw;
}

// ---------------- 假数据（开发期用，完全不请求，不烧配额）----------------
const MOCK_PLACES = [
  "盈港东路", "沪青平公路", "徐泾北城", "赵巷镇",
  "朱家角古镇", "金泽水乡", "白鹤镇", "崧泽大道",
];
const MOCK_NAMES = {
  美食: ["老弄堂面馆", "阿婆本帮菜", "江南小厨", "三两米线", "稻香农家乐"],
  咖啡: ["半日闲咖啡", "拾光烘焙", "河畔咖啡屋", "慢递咖啡"],
  商场: ["吾悦广场", "宝龙城市广场", "奥特莱斯", "老街商业街"],
};

function mockSearch(point, opts) {
  const names = MOCK_NAMES[opts.keyword] || MOCK_NAMES["美食"];
  const n = Math.max(0, Math.floor((opts.radius / 1000) * 4));
  const list = [];
  for (let i = 0; i < Math.min(n, opts.limit || 20); i++) {
    const m = Math.round(Math.random() * opts.radius);
    list.push({
      id: "mock_" + i,
      name: names[i % names.length] + (i > 3 ? "(" + i + "号店)" : ""),
      address: MOCK_PLACES[i % MOCK_PLACES.length] + (i + 1) * 37 + "号",
      category: opts.keyword,
      distance: m,
      distanceText: m < 1000 ? m + "m" : (m / 1000).toFixed(1) + "km",
      latitude: point.latitude + (Math.random() - 0.5) * 0.01,
      longitude: point.longitude + (Math.random() - 0.5) * 0.01,
      rating: null,
      cost: null,
    });
  }
  list.sort((a, b) => a.distance - b.distance);
  return { ok: true, count: n, list, mock: true };
}

// ---------------- 逆地址解析（额度 6000/日，相对充裕）----------------
function reverseGeocode(point) {
  if (MOCK_LBS) {
    return Promise.resolve({
      ok: true,
      mock: true,
      address:
        "上海市青浦区" +
        MOCK_PLACES[Math.floor(Math.random() * MOCK_PLACES.length)] +
        "附近（假数据）",
    });
  }

  if (!TENCENT_MAP_KEY) {
    return Promise.resolve({
      ok: false,
      reason: "nokey",
      address: "配置腾讯位置服务 Key 后（见 config.js）可自动显示具体地名",
    });
  }

  const key = cacheKey("geo", point, {});
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(Object.assign({ cached: true }, cached));

  return requestRetrying(HOST + "/ws/geocoder/v1/", {
    location: point.latitude + "," + point.longitude,
  })
    .then((res) => {
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
        const out = { ok: true, address };
        cacheSet(key, out);
        return out;
      }
      return {
        ok: false,
        reason: "api",
        address: explainStatus(data, "逆地址解析"),
      };
    })
    .catch((err) => {
      console.error("reverseGeocode parse error", err);
      return { ok: false, reason: "parse", address: "地址解析失败" };
    });
}

// ---------------- 地点搜索（额度只有 200/日，是瓶颈）----------------
// 一次返回 count + list：探测荒不荒用 count，确认后的列表直接用 list，
// 不再为同一个 keyword + radius 发两次请求。
function searchNearby(point, opts) {
  if (MOCK_LBS) return Promise.resolve(mockSearch(point, opts));

  if (!TENCENT_MAP_KEY) {
    return Promise.resolve({ ok: false, reason: "nokey", count: 0, list: [] });
  }

  const key = cacheKey("place", point, opts);
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(Object.assign({ cached: true }, cached));

  return requestRetrying(HOST + "/ws/place/v1/search", {
    keyword: opts.keyword,
    boundary:
      "nearby(" +
      point.latitude +
      "," +
      point.longitude +
      "," +
      opts.radius +
      ")",
    orderby: "_distance",
    page_size: opts.limit || 20,
    page_index: 1,
  })
    .then((res) => {
      if (!res.ok) {
        return { ok: false, reason: "network", count: 0, list: [] };
      }
      const data = res.data;
      if (!data || data.status !== 0) {
        return {
          ok: false,
          reason: "api",
          count: 0,
          list: [],
          message: explainStatus(data, "地点搜索"),
        };
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
          distanceText:
            m < 1000 ? Math.round(m) + "m" : (m / 1000).toFixed(1) + "km",
          latitude: item.location && item.location.lat,
          longitude: item.location && item.location.lng,
          // 腾讯不提供，恒为 null。接高德后这里才有值。
          rating: null,
          cost: null,
        };
      });
      const out = { ok: true, count: data.count || list.length, list };
      cacheSet(key, out);
      return out;
    })
    .catch((err) => {
      console.error("searchNearby parse error", err);
      return {
        ok: false,
        reason: "parse",
        count: 0,
        list: [],
        message: "周边查询解析失败",
      };
    });
}

module.exports = {
  provider: MOCK_LBS ? "mock" : "tencent",
  supportsRating: false,
  isMock: MOCK_LBS,
  hasKey,
  reverseGeocode,
  searchNearby,
  clearCache,
};
