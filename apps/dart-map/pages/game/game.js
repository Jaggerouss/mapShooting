const systemInfo = wx.getWindowInfo
  ? wx.getWindowInfo()
  : wx.getSystemInfoSync();
const SCREEN_WIDTH = systemInfo.windowWidth;
const MAX_CANVAS_HEIGHT = systemInfo.windowHeight * 0.55;
const SIDE_MARGIN = 12;
const MAX_UPSCALE = 2.5;

Page({
  data: {
    mapSrc: "",
    canvasWidth: 0,
    canvasHeight: 0,
    power: 50,
    knobX: 0,
    knobY: 0,
    throwing: false,
    showResult: false,
    resultText: "",
    musicOn: true,
  },

  _angle: 0,
  _stickCenter: { x: 0, y: 0 },
  _stickRadius: 70,
  _imgInfo: null,
  _ctx: null,
  _canvasNode: null,
  _dpr: 1,
  _bgmAudio: null,
  _sfxAudio: null,

  onLoad(options) {
    this._noCache = options.noCache === "1";
    this.initAudio();
    if (options.mapPath) {
      this.loadMapImage(decodeURIComponent(options.mapPath));
    }
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

  // ---------------- 地图上传 + 自适应缩放 ----------------
  chooseMap() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (res) => {
        const file = res.tempFiles[0];

        if (file.size > 8 * 1024 * 1024) {
          wx.showToast({ title: "图片太大了，换一张试试", icon: "none" });
          return;
        }

        this.setData({
          showResult: false,
          throwing: false,
          power: 50,
          knobX: 0,
          knobY: 0,
        });
        this._angle = 0;

        this.loadMapImage(file.tempFilePath);
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf("cancel") === -1) {
          wx.showToast({ title: "选择图片失败，请重试", icon: "none" });
        }
      },
    });
  },

  loadMapImage(filePath) {
    wx.showLoading({ title: "加载地图中...", mask: true });

    // /assets/ 路径在真机上 wx.getImageInfo 可能失败，改用 canvas.createImage 直接读取
    if (filePath.startsWith("/assets/")) {
      this._loadLocalAsset(filePath);
      return;
    }

    wx.getImageInfo({
      src: filePath,
      success: (info) => {
        wx.hideLoading();
        this._applyMapInfo(info.path, info.width, info.height);
        if (!this._noCache) this.cacheRecentMap(info.path);
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "图片加载失败，请换一张", icon: "none" });
      },
    });
  },

  // 加载本地 /assets/ 图片（绕过 wx.getImageInfo 的限制）
  _loadLocalAsset(filePath) {
    // 先建一个临时 canvas 读取尺寸
    wx.createSelectorQuery()
      .in(this)
      .select("#mapCanvas")
      .fields({ node: true }, (res) => {
        if (!res || !res.node) {
          // canvas 节点未渲染，先 setData 触发渲染再重试
          this.setData(
            { mapSrc: filePath, canvasWidth: 10, canvasHeight: 10 },
            () => {
              this._loadLocalAsset(filePath);
            },
          );
          return;
        }
        const canvas = res.node;
        const img = canvas.createImage();
        img.onload = () => {
          wx.hideLoading();
          this._applyMapInfo(filePath, img.width, img.height);
          // noCache=1 时不存入最近使用
        };
        img.onerror = () => {
          wx.hideLoading();
          wx.showToast({ title: "预设地图加载失败", icon: "none" });
        };
        img.src = filePath;
      })
      .exec();
  },

  _applyMapInfo(path, imgW, imgH) {
    this._imgInfo = { path, width: imgW, height: imgH };
    this._mapImg = null;
    const targetWidth = SCREEN_WIDTH - SIDE_MARGIN * 2;

    let displayWidth;
    if (imgW < targetWidth) {
      const scale = Math.min(targetWidth / imgW, MAX_UPSCALE);
      displayWidth = imgW * scale;
    } else {
      displayWidth = targetWidth;
    }

    let displayHeight = (imgH / imgW) * displayWidth;

    if (displayHeight > MAX_CANVAS_HEIGHT) {
      const ratio = MAX_CANVAS_HEIGHT / displayHeight;
      displayHeight = MAX_CANVAS_HEIGHT;
      displayWidth = displayWidth * ratio;
    }

    this.setData(
      {
        mapSrc: path,
        canvasWidth: Math.round(displayWidth),
        canvasHeight: Math.round(displayHeight),
      },
      () => {
        this.setupCanvas();
        this._updateStickRect();
      },
    );
  },

  cacheRecentMap(path) {
    let list = wx.getStorageSync("recentMaps") || [];
    list = [path, ...list.filter((p) => p !== path)].slice(0, 5);
    wx.setStorageSync("recentMaps", list);
  },

  // ---------------- Canvas 初始化与绘制 ----------------
  setupCanvas() {
    wx.createSelectorQuery()
      .in(this)
      .select("#mapCanvas")
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res[0].node;
        const dpr = wx.getWindowInfo
          ? wx.getWindowInfo().pixelRatio
          : wx.getSystemInfoSync().pixelRatio;
        canvas.width = this.data.canvasWidth * dpr;
        canvas.height = this.data.canvasHeight * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        this._canvasNode = canvas;
        this._ctx = ctx;
        this._dpr = dpr;

        this.drawMapImage();
      });
  },

  drawMapImage(dartPos) {
    const ctx = this._ctx;
    const { canvasWidth, canvasHeight } = this.data;

    if (this._mapImg) {
      this.paintFrame(ctx, this._mapImg, canvasWidth, canvasHeight, dartPos);
      return;
    }
    const img = this._canvasNode.createImage();
    img.src = this.data.mapSrc;
    img.onload = () => {
      this._mapImg = img;
      this.paintFrame(ctx, img, canvasWidth, canvasHeight, dartPos);
    };
  },

  paintFrame(ctx, img, canvasWidth, canvasHeight, dartPos) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
    if (dartPos) {
      this.drawDartMark(
        ctx,
        img,
        canvasWidth,
        canvasHeight,
        dartPos.x,
        dartPos.y,
      );
    }
  },

  drawDartMark(ctx, img, canvasWidth, canvasHeight, x, y) {
    ctx.save();
    ctx.strokeStyle = "rgba(226, 75, 74, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.strokeStyle = "#e24b4a";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#e24b4a";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();

    this.drawMagnifier(ctx, img, canvasWidth, canvasHeight, x, y);
  },

  drawMagnifier(ctx, img, canvasWidth, canvasHeight, x, y) {
    const boxSize = 100;
    const zoom = 2.5;
    const cropSize = boxSize / zoom;

    const boxX = canvasWidth - boxSize - 10;
    const boxY = 10;

    const scaleToImg = img.width / canvasWidth;
    const srcX = x * scaleToImg - (cropSize * scaleToImg) / 2;
    const srcY = y * scaleToImg - (cropSize * scaleToImg) / 2;
    const srcSize = cropSize * scaleToImg;

    ctx.save();
    ctx.beginPath();
    ctx.arc(
      boxX + boxSize / 2,
      boxY + boxSize / 2,
      boxSize / 2,
      0,
      Math.PI * 2,
    );
    ctx.clip();
    ctx.drawImage(
      img,
      Math.max(0, srcX),
      Math.max(0, srcY),
      srcSize,
      srcSize,
      boxX,
      boxY,
      boxSize,
      boxSize,
    );
    ctx.restore();

    ctx.beginPath();
    ctx.arc(
      boxX + boxSize / 2,
      boxY + boxSize / 2,
      boxSize / 2,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = "#e24b4a";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = "#e24b4a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boxX + boxSize / 2 - 8, boxY + boxSize / 2);
    ctx.lineTo(boxX + boxSize / 2 + 8, boxY + boxSize / 2);
    ctx.moveTo(boxX + boxSize / 2, boxY + boxSize / 2 - 8);
    ctx.lineTo(boxX + boxSize / 2, boxY + boxSize / 2 + 8);
    ctx.stroke();
  },

  onPowerChanging(e) {
    this.setData({ power: e.detail.value });
  },
  onPowerChange(e) {
    this.setData({ power: e.detail.value });
  },

  _updateStickRect() {
    wx.createSelectorQuery()
      .in(this)
      .select(".joystick-base")
      .boundingClientRect()
      .exec((res) => {
        if (!res[0]) return;
        this._stickCenter = {
          x: res[0].left + res[0].width / 2,
          y: res[0].top + res[0].height / 2,
        };
        this._stickRadius = res[0].width / 2;
      });
  },

  onStickStart() {
    this._updateStickRect();
  },

  onStickMove(e) {
    const touch = e.touches[0];
    const dx = touch.clientX - this._stickCenter.x;
    const dy = touch.clientY - this._stickCenter.y;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), this._stickRadius - 10);
    const angle = Math.atan2(dy, dx);

    this._angle = angle;

    this.setData({
      knobX: Math.cos(angle) * dist,
      knobY: Math.sin(angle) * dist,
    });
  },

  onStickEnd() {},

  // ---------------- 投掷核心算法 ----------------
  throwDart() {
    if (this.data.throwing || !this.data.mapSrc) return;
    this.setData({ throwing: true });

    const { canvasWidth, canvasHeight, power } = this.data;
    const angle = this._angle;
    const powerRatio = power / 100;

    const maxReach = Math.min(canvasWidth, canvasHeight) * 0.9;
    const baseDist = maxReach * powerRatio;
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    let targetX = centerX + Math.cos(angle) * baseDist;
    let targetY = centerY + Math.sin(angle) * baseDist;

    const stability = 1 - Math.abs(powerRatio - 0.7) * 1.2;
    const wobble = Math.max(0.15, 1 - Math.max(0, stability)) * 60;
    targetX += this.gaussianRandom() * wobble;
    targetY += this.gaussianRandom() * wobble;

    targetX = Math.max(10, Math.min(canvasWidth - 10, targetX));
    targetY = Math.max(10, Math.min(canvasHeight - 10, targetY));

    this.animateThrow(centerX, centerY, targetX, targetY);
  },

  gaussianRandom() {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  },

  animateThrow(fromX, fromY, toX, toY) {
    const duration = 260;
    const start = Date.now();
    const ctx = this._ctx;

    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const curX = fromX + (toX - fromX) * ease;
      const curY = fromY + (toY - fromY) * ease - Math.sin(t * Math.PI) * 40;

      this.drawMapImage();
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(curX, curY, 6, 0, Math.PI * 2);
      ctx.fill();

      if (t < 1) {
        this._canvasNode.requestAnimationFrame(step);
      } else {
        this.onHit(toX, toY);
      }
    };
    this._canvasNode.requestAnimationFrame(step);
  },

  onHit(x, y) {
    this.drawMapImage({ x, y });
    wx.vibrateShort({ type: "medium" });
    if (this._sfxAudio) {
      this._sfxAudio.stop();
      this._sfxAudio.play();
    }

    const ratio = this._imgInfo.width / this.data.canvasWidth;
    const originX = Math.round(x * ratio);
    const originY = Math.round(y * ratio);

    this.setData({
      throwing: false,
      showResult: true,
      resultText: `命中坐标 (${originX}, ${originY})`,
    });
  },

  closeResult() {
    this.setData({ showResult: false });
  },
  noop() {},

  throwAgain() {
    this.setData({ showResult: false });
    this.drawMapImage();
  },
});
