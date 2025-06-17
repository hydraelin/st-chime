import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const ChimePlugin = {
  STORAGE_KEY: "chime_settings",
  PERMISSION_KEY: "chime_audio_permission",
  
  state: {
    chimeEnabled: new Set(),
    chimeSelect: "default",
    chimeVolume: 1.0,
    audioContext: null,
    hasAudioPermission: false,
    customChimes: [],
    pendingPlayPromise: null,
    audioElement: null,
    initializedPermission: false
  },
  
  CHIME_CONFIG: {
    default: `scripts/extensions/third-party/st-chime/assets/default/true.mp3`,
    doubao: `scripts/extensions/third-party/st-chime/assets/doubao/true.mp3`,
  },
  
  initSettings() {
    const settings = localStorage.getItem(this.STORAGE_KEY);
    if (settings) {
      const parsed = JSON.parse(settings);
      this.state = {
        ...this.state,
        chimeEnabled: new Set(parsed.chimeEnabled),
        chimeSelect: parsed.chimeSelect || "default",
        chimeVolume: parsed.chimeVolume || 1.0,
        customChimes: parsed.customChimes || []
      };
    }
    this.state.initializedPermission = localStorage.getItem(this.PERMISSION_KEY) === "granted";
    this.state.hasAudioPermission = this.state.initializedPermission;
  },
  
  mergeCustomChimes() {
    this.state.customChimes.forEach(chime => {
      this.CHIME_CONFIG[chime.id] = chime.url;
    });
  },
  
  createSettingsUI() {
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
            <div id="audio_permission_status" class="chime-permission-status chime-status-info"></div>
          </div>
          <div class="chime-custom-audio">
            <div class="chime-section-header"><strong>自定义音频(beta)</strong></div>
            <div class="chime-add-audio">
              <input type="text" id="custom_audio_name" class="chime-audio-input" placeholder="音频名称">
              <input type="url" id="custom_audio_url" class="chime-audio-input" placeholder="音频URL (MP3格式)">
              <button id="add_custom_audio" class="chime-add-button"><i class="fa-solid fa-plus mr-1"></i>添加</button>
            </div>
            <div class="chime-audio-list" id="custom_audio_list">
              ${this.state.customChimes.length ? this.state.customChimes.map(chime => `
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
    Object.keys(this.CHIME_CONFIG).forEach(key => {
      select.append($("<option>").val(key).text(key === "default" ? "默认" : key === "doubao" ? "豆包" : key));
    });

    $("#chime_enabled").prop("checked", this.state.chimeEnabled.has("enabled"));
    $("#chime_select").val(this.state.chimeSelect);
    $("#chime_volume").val(this.state.chimeVolume);
    this.updateVolumeDisplay();
    this.updatePermissionStatus();

    $("#chime_enabled").on("change.chime", this.onChimeEnabled.bind(this));
    $("#chime_select").on("change.chime", this.onChimeSelect.bind(this));
    $("#chime_test").on("click.chime", this.onChimeTest.bind(this));
    $("#chime_volume").on("input.chime", this.onChimeVolume.bind(this));
    $("#add_custom_audio").on("click.chime", this.addCustomAudio.bind(this));
    $(document).on("click.chime", ".chime-remove-button", this.removeCustomAudio.bind(this));
  },
  
  async requestAudioPermission() {
    if (this.state.hasAudioPermission) return true;
    
    try {
      this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = this.state.audioContext.createBuffer(1, 1, 22050);
      const source = this.state.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.state.audioContext.destination);
      await source.start(0);
      
      localStorage.setItem(this.PERMISSION_KEY, "granted");
      this.state.hasAudioPermission = true;
      this.state.initializedPermission = true;
      this.updatePermissionStatus("音频权限已获取，后续将自动播放", "success");
      return true;
    } catch (err) {
      this.updatePermissionStatus("请点击测试按钮启用声音", "warning");
      return false;
    }
  },
  
  updatePermissionStatus(msg = "", type = "") {
    const el = $("#audio_permission_status");
    if (!msg) {
      el.text(this.state.initializedPermission 
        ? "已获取音频权限，新消息将自动播放提醒" 
        : "点击测试按钮获取音频权限以启用提醒");
      el.removeClass("chime-status-success chime-status-warning chime-status-error chime-status-info");
      el.addClass(this.state.initializedPermission ? "chime-status-success" : "chime-status-info");
      return;
    }
    el.text(msg);
    el.removeClass("chime-status-success chime-status-warning chime-status-error chime-status-info");
    el.addClass(`chime-status-${type}`);
  },
  
  playChimeSound() {
    if (!this.state.chimeEnabled.has("enabled") || !this.state.initializedPermission) return;
    
    const url = this.CHIME_CONFIG[this.state.chimeSelect];
    if (!url) {
      this.updatePermissionStatus("音频URL无效", "error");
      return;
    }

    if (this.state.audioElement) this.state.audioElement.pause();
    this.state.audioElement = new Audio(url);
    this.state.audioElement.volume = this.state.chimeVolume;

    const btn = $("#chime_test");
    btn.addClass("animate-pulse");

    this.state.audioElement.play().catch(err => {
      btn.removeClass("animate-pulse");
      if (this.state.audioContext && this.state.audioContext.state === "suspended") {
        this.state.audioContext.resume().then(() => this.state.audioElement.play());
      } else {
        this.updatePermissionStatus("播放失败，请检查浏览器设置", "error");
        this.state.initializedPermission = false;
        localStorage.removeItem(this.PERMISSION_KEY);
      }
    });
  },
  
  updateVolumeDisplay() {
    const percent = Math.round(this.state.chimeVolume * 100);
    $("#volume_value").text(`${percent}%`);
    const slider = $("#chime_volume");
    const value = ((slider.val() - slider.attr("min")) / (slider.attr("max") - slider.attr("min"))) * 100;
    slider.css("background", `linear-gradient(to right, var(--chime-accent) 0%, var(--chime-accent) ${value}%, var(--chime-bg-light) ${value}%, var(--chime-bg-light) 100%)`);
  },
  
  onChimeEnabled(e) {
    e.target.checked ? this.state.chimeEnabled.add("enabled") : this.state.chimeEnabled.delete("enabled");
    this.saveSettings();
  },
  
  onChimeSelect(e) {
    this.state.chimeSelect = $(e.target).val();
    this.saveSettings();
  },
  
  onChimeVolume(e) {
    this.state.chimeVolume = parseFloat($(e.target).val());
    if (this.state.audioElement) this.state.audioElement.volume = this.state.chimeVolume;
    this.updateVolumeDisplay();
    this.saveSettings();
  },
  
  onChimeTest() {
    if (!this.state.initializedPermission) {
      this.requestAudioPermission().then(granted => {
        if (granted) this.playChimeSound();
      });
    } else {
      this.playChimeSound();
    }
  },
  
  addCustomAudio() {
    const name = $("#custom_audio_name").val().trim();
    const url = $("#custom_audio_url").val().trim();
    if (!name || !url) return this.showNotification("请输入名称和URL", "error");
    
    try { new URL(url); } catch { return this.showNotification("请输入有效URL", "error"); }
    if (this.state.customChimes.some(c => c.name === name)) return this.showNotification("已存在同名音频", "error");
    
    const id = "custom_" + Date.now();
    this.state.customChimes.push({ id, name, url });
    this.CHIME_CONFIG[id] = url;
    
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
    
    $(`[data-id="${id}"] .chime-remove-button`).on("click.chime", () => this.removeCustomAudio(id));
    $("#custom_audio_name").val("");
    $("#custom_audio_url").val("");
    this.saveSettings();
    this.showNotification("音频已添加", "success");
  },
  
  removeCustomAudio(e) {
    const id = $(e.currentTarget).closest(".chime-audio-item").data("id");
    this.state.customChimes = this.state.customChimes.filter(c => c.id !== id);
    delete this.CHIME_CONFIG[id];
    
    $(`[data-id="${id}"]`).fadeOut(300, () => {
      $(this).remove();
      const list = $("#custom_audio_list");
      if (list.children().length === 0) {
        list.append('<div class="chime-empty-list text-gray-500 text-sm">暂无自定义音频</div>');
      }
    });
    
    if (this.state.chimeSelect === id) {
      this.state.chimeSelect = "default";
      $("#chime_select").val(this.state.chimeSelect);
      this.saveSettings();
    }
    this.showNotification("音频已删除", "success");
  },
  
  saveSettings() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
      chimeEnabled: Array.from(this.state.chimeEnabled),
      chimeSelect: this.state.chimeSelect,
      chimeVolume: this.state.chimeVolume,
      customChimes: this.state.customChimes
    }));
    saveSettingsDebounced();
  },
  
  showNotification(msg, type) {
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
  },
  
  handleNewMessageEvent() {
    if (this.state.chimeEnabled.has("enabled") && this.state.initializedPermission) {
      this.playChimeSound();
    } else {
      this.updatePermissionStatus();
    }
  },
  
  init() {
    this.initSettings();
    this.mergeCustomChimes();
    this.createSettingsUI();
    eventSource.on(event_types.MESSAGE_RECEIVED, this.handleNewMessageEvent.bind(this));
  }
};

jQuery(function($) {
  ChimePlugin.init();
});