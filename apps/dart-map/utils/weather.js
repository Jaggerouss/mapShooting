// 天气适配层。用高德的天气接口，因为它直接吃 adcode ——
// 而我们的 region id 本来就是 adcode（310000 / 310118 / 310118109），不用额外映射。
//
//   GET https://restapi.amap.com/v3/weather/weatherInfo?city=310118&key=KEY&extensions=base
//
// 要用的话：
//   1. https://lbs.amap.com 申请 Key，服务平台选「Web服务」
//   2. config.js 里填 AMAP_KEY
//   3. 微信后台 request 合法域名加 https://restapi.amap.com
//
// 没配 Key 就静默降级（ok:false），页面不显示天气条，其余功能不受影响。
// 承诺永不 reject、永不抛。

let AMAP_KEY = "";
let MOCK_LBS = false;
try {
  const cfg = require("../config.js");
  AMAP_KEY = cfg.AMAP_KEY || "";
  MOCK_LBS = !!cfg.MOCK_LBS;
} catch (e) {}

const HOST = "https://restapi.amap.com";
const CACHE_KEY = "weather:v1";
const CACHE_TTL = 30 * 60 * 1000; // 半小时，天气没必要更勤

// 高德的 weather 字段是中文描述：晴 / 多云 / 小雨 / 雷阵雨 / 中雪 ...
const RAINY = /雨|雪|雷|冰雹|沙尘|霾/;

function hasKey() {
  return MOCK_LBS || !!AMAP_KEY;
}

function isRainyText(text) {
  return RAINY.test(text || "");
}

function cacheGet(adcode) {
  try {
    const all = wx.getStorageSync(CACHE_KEY) || {};
    const hit = all[adcode];
    if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;
  } catch (e) {}
  return null;
}

function cacheSet(adcode, value) {
  try {
    const all = wx.getStorageSync(CACHE_KEY) || {};
    all[adcode] = { t: Date.now(), v: value };
    wx.setStorageSync(CACHE_KEY, all);
  } catch (e) {}
}

function today(adcode) {
  if (MOCK_LBS) {
    // mock 时给个下雨，方便验雨天分支
    return Promise.resolve({
      ok: true,
      mock: true,
      text: "小雨",
      temperature: "18",
      isRainy: true,
    });
  }

  if (!AMAP_KEY) return Promise.resolve({ ok: false, reason: "nokey" });

  const cached = cacheGet(adcode);
  if (cached) return Promise.resolve(Object.assign({ cached: true }, cached));

  return new Promise((resolve) => {
    wx.request({
      url: HOST + "/v3/weather/weatherInfo",
      data: { city: adcode, key: AMAP_KEY, extensions: "base" },
      success: (res) => {
        const d = res.data;
        // 高德的 status 是字符串 "1"，不是数字
        if (!d || d.status !== "1" || !d.lives || !d.lives.length) {
          resolve({
            ok: false,
            reason: "api",
            message: (d && d.info) || "天气查询失败",
          });
          return;
        }
        const live = d.lives[0];
        const out = {
          ok: true,
          text: live.weather,
          temperature: live.temperature,
          isRainy: isRainyText(live.weather),
        };
        cacheSet(adcode, out);
        resolve(out);
      },
      fail: () => resolve({ ok: false, reason: "network" }),
    });
  }).catch((err) => {
    console.error("weather error", err);
    return { ok: false, reason: "parse" };
  });
}

module.exports = { hasKey, today, isRainyText };
