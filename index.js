import {
  saveSettingsDebounced,
  eventSource,
  event_types,
} from "../../../../script.js";

const STORAGE_KEY = "chime_settings";
const chimeSettings = localStorage.getItem(STORAGE_KEY);
const path = `scripts/extensions/third-party/st-chime`;

// 初始化设置状态
let chimeEnabled = new Set();
let chimeSelect = "default";
let chimeVolume = 1.0;
let audioContext = null;
let hasAudioPermission = false;
let customChimes = [];

if (chimeSettings) {
  const settings = JSON.parse(chimeSettings);
  chimeEnabled = new Set(settings.chimeEnabled);
  chimeSelect = settings.chimeSelect || "default";
  chimeVolume = settings.chimeVolume || 1.0;
  customChimes = settings.customChimes || [];
}

// 铃声映射配置
let CHIME_CONFIG = {
  default: `${path}/assets/default/true.mp3`,
  doubao: `${path}/assets/doubao/true.mp3`,
};

// 合并自定义铃声
customChimes.forEach((chime) => {
  CHIME_CONFIG[chime.id] = chime.url;
});

// 音频元素
let audioElement = null;

// 创建设置界面
function createSettings() {
  const container = $(`
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>更多提醒铃声</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <!-- 启用开关 -->
          <div class="chime-toggle-container">
            <label class="chime-toggle-label" for="chime_enabled">
              <input id="chime_enabled" type="checkbox" class="chime-toggle-checkbox" />
              <span class="chime-toggle-text"><strong>启用插件</strong></span>
            </label>
          </div>
          
          <!-- 音频设置区域 -->
          <div class="chime-audio-settings">
            <div class="chime-section-header">
              <strong>音频设置</strong>
            </div>
            
            <div class="chime-select-container">
              <label for="chime_select">音频包：</label>
              <select id="chime_select" class="chime-select"></select>
            </div>
            
            <div class="chime-test-container">
              <button id="chime_test" class="chime-test-button">
                <i class="fa fa-volume-up mr-1"></i>测试音效
              </button>
            </div>
            
            <div class="chime-volume-container">
              <div class="chime-volume-label">
                <label for="chime_volume">音量：</label>
                <span id="volume_value" class="chime-volume-value">100%</span>
              </div>
              <input type="range" id="chime_volume" class="chime-volume-slider" min="0" max="1" step="0.05" value="1">
            </div>
            
            <div id="audio_permission_status" class="chime-permission-status chime-status-warning"></div>
          </div>
          
          <!-- 自定义音频管理区域 -->
          <div class="chime-custom-audio">
            <div class="chime-section-header">
              <strong>自定义音频(beta)</strong>
            </div>
            
            <div class="chime-add-audio">
              <input type="text" id="custom_audio_name" class="chime-audio-input" placeholder="音频名称">
              <input type="url" id="custom_audio_url" class="chime-audio-input" placeholder="音频URL (MP3格式)">
              <button id="add_custom_audio" class="chime-add-button">
                <i class="fa-solid fa-plus mr-1"></i>添加
              </button>
            </div>
            
            <div class="chime-audio-list" id="custom_audio_list">
              ${
                customChimes.length > 0
                  ? customChimes
                      .map(
                        (chime) => `
                <div class="chime-audio-item" data-id="${chime.id}">
                  <span class="chime-audio-name">${chime.name}</span>
                  <span class="chime-audio-url">${chime.url}</span>
                  <button class="chime-remove-button">
                    <i class="fa-solid fa-trash mr-1"></i>删除
                  </button>
                </div>
              `
                      )
                      .join("")
                  : '<div class="chime-empty-list text-gray-500 text-sm">暂无自定义音频</div>'
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  $("#extensions_settings").append(container);

  // 动态填充音频包选项
  const selectElement = $("#chime_select");
  Object.keys(CHIME_CONFIG).forEach((key) => {
    const option = $("<option>")
      .val(key)
      .text(
        key === "default"
          ? "默认"
          : key === "doubao"
          ? "豆包"
          : CHIME_CONFIG[key].name || key
      );
    selectElement.append(option);
  });

  // 初始化UI状态
  $("#chime_enabled").prop("checked", chimeEnabled.has("enabled"));
  $("#chime_select").val(chimeSelect);
  $("#chime_volume").val(chimeVolume);
  updateVolumeDisplay();

  // 绑定事件处理 - 改为通过JavaScript绑定
  $("#chime_enabled").on("change", onChimeEnabled);
  $("#chime_select").on("change", onChimeSelect);
  $("#chime_test").on("click", onChimeTest);
  $("#chime_volume").on("input", onChimeVolume);
  $("#add_custom_audio").on("click", addCustomAudio);

  // 为现有自定义音频绑定删除事件
  $(".chime-remove-button").on("click", function () {
    const audioId = $(this).closest(".chime-audio-item").data("id");
    removeCustomAudio(audioId);
  });

  // 初始化抽屉状态
  initDrawerToggle();

  // 首次交互时请求音频权限
  setupAudioPermissionRequest();
}

// 初始化抽屉开关
function initDrawerToggle() {
  const drawerHeader = $(".chime-drawer-header");
  const drawerContent = $(".chime-drawer-content");
  const drawerIcon = $(".chime-drawer-icon");

  // 切换抽屉展开/折叠状态
  drawerHeader.on("click", function () {
    drawerContent.slideToggle(200);
    drawerIcon.toggleClass("down up");
  });

  // 默认展开抽屉
  drawerContent.hide();
}

// 设置音频权限请求
function setupAudioPermissionRequest() {
  if (hasAudioPermission) return;

  const statusEl = $("#audio_permission_status");

  const requestPermission = () => {
    requestAudioContext()
      .then(() => {
        hasAudioPermission = true;
        updatePermissionStatus("音频权限已获取", "success");

        // 移除监听器
        $(document).off("click", requestPermission);
        $(document).off("keydown", requestPermission);
      })
      .catch((err) => {
        console.error("获取音频权限失败:", err);
        updatePermissionStatus("请点击测试按钮启用声音", "warning");
      });
  };

  $(document).one("click", requestPermission);
  $(document).one("keydown", requestPermission);

  updatePermissionStatus("请与页面交互以启用声音", "warning");
}

// 更新权限状态显示
function updatePermissionStatus(message, status) {
  const statusEl = $("#audio_permission_status");
  statusEl.text(message);

  // 移除所有状态类
  statusEl.removeClass(
    "chime-status-success chime-status-warning chime-status-error"
  );

  // 添加新的状态类
  if (status === "success") {
    statusEl.addClass("chime-status-success");
  } else if (status === "warning") {
    statusEl.addClass("chime-status-warning");
  } else if (status === "error") {
    statusEl.addClass("chime-status-error");
  }
}

// 请求音频上下文
async function requestAudioContext() {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = audioContext.createBuffer(1, 1, 22050);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      await source.start(0);
      return true;
    } catch (err) {
      console.error("创建音频上下文失败:", err);
      return false;
    }
  }
  return true;
}

// 启用状态变更处理
function onChimeEnabled() {
  if (this.checked) {
    chimeEnabled.add("enabled");
  } else {
    chimeEnabled.delete("enabled");
  }
  saveSettings();
}

// 音频包选择变更处理
function onChimeSelect() {
  chimeSelect = $(this).val();
  saveSettings();
}

// 音量变更处理
function onChimeVolume() {
  chimeVolume = parseFloat($(this).val());
  updateVolumeDisplay();

  if (audioElement) {
    audioElement.volume = chimeVolume;
  }

  saveSettings();
}

// 更新音量显示
function updateVolumeDisplay() {
  const volumePercent = Math.round(chimeVolume * 100);
  $("#volume_value").text(`${volumePercent}%`);

  // 更新音量滑块样式
  const volumeSlider = $("#chime_volume");
  const value =
    ((volumeSlider.val() - volumeSlider.attr("min")) /
      (volumeSlider.attr("max") - volumeSlider.attr("min"))) *
    100;
  volumeSlider.css(
    "background",
    `linear-gradient(to right, var(--chime-accent) 0%, var(--chime-accent) ${value}%, var(--chime-bg-light) ${value}%, var(--chime-bg-light) 100%)`
  );
}

// 测试音效处理
function onChimeTest() {
  if (!hasAudioPermission) {
    requestAudioContext()
      .then(() => {
        hasAudioPermission = true;
        playChime();
      })
      .catch((err) => {
        console.error("播放测试音失败:", err);
        updatePermissionStatus("无法播放声音，请检查浏览器设置", "error");
      });
  } else {
    playChime();
  }
}

// 播放铃声
function playChime() {
  if (!chimeEnabled.has("enabled")) return;

  if (!hasAudioPermission) {
    console.warn("未获得音频播放权限");
    return;
  }

  if (audioElement) {
    audioElement.pause();
    audioElement = null;
  }

  // 验证URL有效性
  const audioUrl = CHIME_CONFIG[chimeSelect];
  if (!audioUrl) {
    console.error("无效的音频URL");
    updatePermissionStatus("音频URL无效", "error");
    return;
  }

  audioElement = new Audio(audioUrl);
  audioElement.volume = chimeVolume;

  // 添加播放动画效果
  const testButton = $("#chime_test");
  testButton.addClass("animate-pulse");

  audioElement
    .play()
    .then(() => {
      // 播放成功后移除动画
      setTimeout(() => testButton.removeClass("animate-pulse"), 500);
    })
    .catch((e) => {
      console.error("播放铃声失败:", e);
      testButton.removeClass("animate-pulse");

      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume().then(() => {
          console.log("音频上下文已恢复");
          audioElement.play();
        });
      } else {
        updatePermissionStatus(
          "播放失败，请确保您的浏览器允许声音播放",
          "error"
        );
      }
    });
}

// 新消息处理
function handleNewMessage() {
  if (chimeEnabled.has("enabled")) {
    playChime();
  }
}

// 保存设置
function saveSettings() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      chimeEnabled: Array.from(chimeEnabled),
      chimeSelect: chimeSelect,
      chimeVolume: chimeVolume,
      customChimes: customChimes,
    })
  );

  saveSettingsDebounced();
}

// 添加自定义音频
function addCustomAudio() {
  const name = $("#custom_audio_name").val().trim();
  const url = $("#custom_audio_url").val().trim();

  if (!name || !url) {
    showNotification("请输入音频名称和URL", "error");
    return;
  }

  // 简单验证URL格式
  try {
    new URL(url);
  } catch (e) {
    showNotification("请输入有效的URL", "error");
    return;
  }

  // 检查是否已存在同名音频
  if (customChimes.some((chime) => chime.name === name)) {
    showNotification("已存在同名音频", "error");
    return;
  }

  // 生成唯一ID
  const id = "custom_" + Date.now();

  // 添加到配置
  customChimes.push({ id, name, url });
  CHIME_CONFIG[id] = url;

  // 更新UI
  $("#chime_select").append(`<option value="${id}">${name}</option>`);

  const audioList = $("#custom_audio_list");
  if (audioList.find(".chime-empty-list").length > 0) {
    audioList.empty();
  }

  audioList.append(`
    <div class="chime-audio-item" data-id="${id}">
      <span class="chime-audio-name">${name}</span>
      <span class="chime-audio-url">${url}</span>
      <button class="chime-remove-button">
        <i class="fa-solid fa-trash mr-1"></i>删除
      </button>
    </div>
  `);

  // 绑定删除事件
  $(`[data-id="${id}"] .chime-remove-button`).on("click", function () {
    removeCustomAudio(id);
  });

  // 清空输入
  $("#custom_audio_name").val("");
  $("#custom_audio_url").val("");

  // 保存设置
  saveSettings();

  // 显示成功通知
  showNotification("音频已添加", "success");
}

// 移除自定义音频
function removeCustomAudio(id) {
  // 从配置中移除
  const index = customChimes.findIndex((chime) => chime.id === id);
  if (index !== -1) {
    customChimes.splice(index, 1);
    delete CHIME_CONFIG[id];
  }

  // 更新UI
  const audioItem = $(`[data-id="${id}"]`);
  audioItem.fadeOut(300, function () {
    $(this).remove();

    // 如果列表为空，显示空状态
    const audioList = $("#custom_audio_list");
    if (audioList.children().length === 0) {
      audioList.append(
        '<div class="chime-empty-list text-gray-500 text-sm">暂无自定义音频</div>'
      );
    }
  });

  // 如果当前选择的是被删除的音频，切换到默认
  if (chimeSelect === id) {
    chimeSelect = "default";
    $("#chime_select").val(chimeSelect);
    saveSettings();
  }

  // 显示通知
  showNotification("音频已删除", "success");
}

// 显示临时通知
function showNotification(message, type) {
  const notification = $(`
    <div class="chime-notification chime-status-${type} fixed bottom-4 right-4 p-3 rounded-lg shadow-lg z-50 transform transition-all duration-300 opacity-0 translate-y-4">
      ${message}
    </div>
  `);

  $("body").append(notification);

  // 显示通知
  setTimeout(() => {
    notification.removeClass("opacity-0 translate-y-4");
  }, 10);

  // 3秒后隐藏通知
  setTimeout(() => {
    notification.addClass("opacity-0 translate-y-4");
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// 初始化
jQuery(() => {
  createSettings();
  eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
});
