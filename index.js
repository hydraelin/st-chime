import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const STORAGE_KEY = "chime_settings";
const path = `scripts/extensions/third-party/st-chime`;

// 状态管理
let chimeEnabled = new Set();
let chimeSelect = "default";
let chimeVolume = 1.0;
let audioContext = null;
let hasAudioPermission = false;
let customChimes = [];
let isUserInteracted = false;
let pendingPlayPromise = null;

// 初始化设置
const initSettings = () => {
  const settings = localStorage.getItem(STORAGE_KEY);
  if (settings) {
    const parsed = JSON.parse(settings);
    chimeEnabled = new Set(parsed.chimeEnabled);
    chimeSelect = parsed.chimeSelect || "default";
    chimeVolume = parsed.chimeVolume || 1.0;
    customChimes = parsed.customChimes || [];
  }
};

// 铃声配置
let CHIME_CONFIG = {
  default: `${path}/assets/default/true.mp3`,
  doubao: `${path}/assets/doubao/true.mp3`,
};

// 合并自定义铃声
const mergeCustomChimes = () => {
  customChimes.forEach(chime => {
    CHIME_CONFIG[chime.id] = chime.url;
  });
};

// 创建设置界面
const createSettingsUI = () => {
  const container = $(`
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>更多提醒铃声</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="chime-toggle-container">
          <label class="chime-toggle-label" for="chime_enabled">
            <input id="chime_enabled" type="checkbox" class="chime-toggle-checkbox">
            <span class="chime-toggle-text"><strong>启用插件</strong></span>
          </label>
        </div>
        <div class="chime-audio-settings">
          <div class="chime-section-header"><strong>音频设置</strong></div>
          <div class="chime-select-container"><label for="chime_select">音频包：</label><select id="chime_select" class="chime-select"></select></div>
          <div class="chime-test-container"><button id="chime_test" class="chime-test-button"><i class="fa fa-volume-up mr-1"></i>测试音效</button></div>
          <div class="chime-volume-container">
            <div class="chime-volume-label"><label for="chime_volume">音量：</label><span id="volume_value" class="chime-volume-value">100%</span></div>
            <input type="range" id="chime_volume" class="chime-volume-slider" min="0" max="1" step="0.05" value="1">
          </div>
          <div id="audio_permission_status" class="chime-permission-status chime-status-warning"></div>
        </div>
        <div class="chime-custom-audio">
          <div class="chime-section-header"><strong>自定义音频(beta)</strong></div>
          <div class="chime-add-audio">
            <input type="text" id="custom_audio_name" class="chime-audio-input" placeholder="音频名称">
            <input type="url" id="custom_audio_url" class="chime-audio-input" placeholder="音频URL (MP3格式)">
            <button id="add_custom_audio" class="chime-add-button"><i class="fa-solid fa-plus mr-1"></i>添加</button>
          </div>
          <div class="chime-audio-list" id="custom_audio_list">
            ${customChimes.length ? customChimes.map(chime => `
              <div class="chime-audio-item" data-id="${chime.id}">
                <span class="chime-audio-name">${chime.name}</span>
                <span class="chime-audio-url">${chime.url}</span>
                <button class="chime-remove-button"><i class="fa-solid fa-trash mr-1"></i>删除</button>
              </div>
            `).join("") : '<div class="chime-empty-list text-gray-500 text-sm">暂无自定义音频</div>'}
          </div>
        </div>
      </div>
    </div>
  `);

  $("#extensions_settings").append(container);
  const select = $("#chime_select");
  Object.keys(CHIME_CONFIG).forEach(key => {
    select.append($("<option>").val(key).text(key === "default" ? "默认" : key === "doubao" ? "豆包" : key));
  });

  // 初始化UI状态
  $("#chime_enabled").prop("checked", chimeEnabled.has("enabled"));
  $("#chime_select").val(chimeSelect);
  $("#chime_volume").val(chimeVolume);
  updateVolumeDisplay();

  // 绑定事件
  $("#chime_enabled").on("change", onChimeEnabled);
  $("#chime_select").on("change", onChimeSelect);
  $("#chime_test").on("click", onChimeTest);
  $("#chime_volume").on("input", onChimeVolume);
  $("#add_custom_audio").on("click", addCustomAudio);
  $(".chime-remove-button").on("click", function() {
    removeCustomAudio($(this).closest(".chime-audio-item").data("id"));
  });

  // 抽屉交互
  const header = $(".inline-drawer-header");
  const content = $(".inline-drawer-content");
  const icon = $(".inline-drawer-icon");
  header.on("click", () => {
    content.slideToggle(200);
    icon.toggleClass("down up");
  });
  content.hide();
};

// 请求音频权限
const requestAudioPermission = async () => {
  if (hasAudioPermission) return true;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = audioContext.createBuffer(1, 1, 22050);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    await source.start(0);
    hasAudioPermission = true;
    updatePermissionStatus("音频权限已获取", "success");
    return true;
  } catch (err) {
    console.error("音频权限请求失败", err);
    updatePermissionStatus("请点击测试按钮启用声音", "warning");
    return false;
  }
};

// 更新权限状态显示
const updatePermissionStatus = (msg, status) => {
  const el = $("#audio_permission_status");
  el.text(msg);
  el.removeClass("chime-status-success chime-status-warning chime-status-error");
  el.addClass(`chime-status-${status}`);
};

// 标记用户交互
const markUserInteraction = () => {
  if (!isUserInteracted) {
    isUserInteracted = true;
    requestAudioPermission();
  }
};

// 播放铃声
const playChimeSound = () => {
  if (!chimeEnabled.has("enabled")) return;
  if (!hasAudioPermission && !isUserInteracted) {
    pendingPlayPromise = playChimeSound;
    updatePermissionStatus("请与页面交互以启用声音", "warning");
    return;
  }
  if (!hasAudioPermission) {
    updatePermissionStatus("无音频权限", "error");
    return;
  }

  const url = CHIME_CONFIG[chimeSelect];
  if (!url) {
    updatePermissionStatus("音频URL无效", "error");
    return;
  }

  if (audioElement) audioElement.pause();
  audioElement = new Audio(url);
  audioElement.volume = chimeVolume;

  const btn = $("#chime_test");
  btn.addClass("animate-pulse");

  audioElement.play().then(() => {
    setTimeout(() => btn.removeClass("animate-pulse"), 500);
  }).catch(err => {
    btn.removeClass("animate-pulse");
    if (err.name === "NotAllowedError") {
      updatePermissionStatus("请点击页面按钮启用声音", "warning");
      markUserInteraction();
    } else if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().then(() => audioElement.play());
    } else {
      updatePermissionStatus("播放失败，请检查浏览器设置", "error");
    }
  });
};

// 音量更新
const updateVolumeDisplay = () => {
  const percent = Math.round(chimeVolume * 100);
  $("#volume_value").text(`${percent}%`);
  const slider = $("#chime_volume");
  const value = ((slider.val() - slider.attr("min")) / (slider.attr("max") - slider.attr("min"))) * 100;
  slider.css("background", `linear-gradient(to right, var(--chime-accent) 0%, var(--chime-accent) ${value}%, var(--chime-bg-light) ${value}%, var(--chime-bg-light) 100%)`);
};

// 事件处理函数
const onChimeEnabled = () => {
  this.checked ? chimeEnabled.add("enabled") : chimeEnabled.delete("enabled");
  saveSettings();
};

const onChimeSelect = () => {
  chimeSelect = $(this).val();
  saveSettings();
};

const onChimeVolume = () => {
  chimeVolume = parseFloat($(this).val());
  if (audioElement) audioElement.volume = chimeVolume;
  updateVolumeDisplay();
  saveSettings();
};

const onChimeTest = () => {
  markUserInteraction();
  playChimeSound();
};

// 自定义音频管理
const addCustomAudio = () => {
  const name = $("#custom_audio_name").val().trim();
  const url = $("#custom_audio_url").val().trim();
  if (!name || !url) return showNotification("请输入名称和URL", "error");
  
  try { new URL(url); } catch { return showNotification("请输入有效URL", "error"); }
  if (customChimes.some(c => c.name === name)) return showNotification("已存在同名音频", "error");
  
  const id = "custom_" + Date.now();
  customChimes.push({ id, name, url });
  CHIME_CONFIG[id] = url;
  
  const select = $("#chime_select");
  select.append($("<option>").val(id).text(name));
  
  const list = $("#custom_audio_list");
  if (list.children().length === 0) list.empty();
  list.append(`
    <div class="chime-audio-item" data-id="${id}">
      <span class="chime-audio-name">${name}</span>
      <span class="chime-audio-url">${url}</span>
      <button class="chime-remove-button"><i class="fa-solid fa-trash mr-1"></i>删除</button>
    </div>
  `);
  
  $(`[data-id="${id}"] .chime-remove-button`).on("click", () => removeCustomAudio(id));
  $("#custom_audio_name").val("");
  $("#custom_audio_url").val("");
  saveSettings();
  showNotification("音频已添加", "success");
};

const removeCustomAudio = (id) => {
  customChimes = customChimes.filter(c => c.id !== id);
  delete CHIME_CONFIG[id];
  
  $(`[data-id="${id}"]`).fadeOut(300, () => {
    $(this).remove();
    const list = $("#custom_audio_list");
    if (list.children().length === 0) {
      list.append('<div class="chime-empty-list text-gray-500 text-sm">暂无自定义音频</div>');
    }
  });
  
  if (chimeSelect === id) {
    chimeSelect = "default";
    $("#chime_select").val(chimeSelect);
    saveSettings();
  }
  showNotification("音频已删除", "success");
};

// 保存设置
const saveSettings = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    chimeEnabled: Array.from(chimeEnabled),
    chimeSelect,
    chimeVolume,
    customChimes
  }));
  saveSettingsDebounced();
};

// 显示通知
const showNotification = (msg, type) => {
  const notify = $(`
    <div class="chime-notification chime-status-${type} fixed bottom-4 right-4 p-3 rounded-lg shadow-lg z-50 transform transition-all duration-300 opacity-0 translate-y-4">
      ${msg}
    </div>
  `);
  $("body").append(notify);
  setTimeout(() => notify.removeClass("opacity-0 translate-y-4"), 10);
  setTimeout(() => {
    notify.addClass("opacity-0 translate-y-4");
    setTimeout(() => notify.remove(), 300);
  }, 3000);
};

// 新消息处理
const handleNewMessageEvent = () => {
  if (chimeEnabled.has("enabled")) {
    if (hasAudioPermission && isUserInteracted) {
      playChimeSound();
    } else if (!isUserInteracted) {
      pendingPlayPromise = playChimeSound;
      updatePermissionStatus("请与页面交互以启用声音提醒", "warning");
    }
  }
};

// 初始化
const init = () => {
  initSettings();
  mergeCustomChimes();
  createSettingsUI();
  
  // 监听首次用户交互
  $(document).on("click mousedown keydown touchstart", () => {
    if (!isUserInteracted) {
      isUserInteracted = true;
      $(document).off("click mousedown keydown touchstart");
      requestAudioPermission().then(() => {
        if (pendingPlayPromise) {
          const play = pendingPlayPromise;
          pendingPlayPromise = null;
          play();
        }
      });
    }
  });
  
  eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessageEvent);
};

jQuery(init);