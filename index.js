import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const ChimePlugin = {
    // 用于在 localStorage 中存储设置的键名
    STORAGE_KEY: "chime_settings",
    // 用于在 localStorage 中存储音频权限状态的键名
    PERMISSION_KEY: "chime_audio_permission",

    state: {
        chimeEnabled: new Set(),
        chimeSelect: "default",
        chimeVolume: 1.0,
        customChimes: [],
        // --- 音频核心状态 ---
        audioContext: null, // 音频上下文，用于解决移动端播放限制
        audioElement: null, // 单一的、可复用的Audio元素
        hasAudioPermission: false, // 标记是否已获取音频权限
    },

    // 预设和自定义的音频配置
    CHIME_CONFIG: {
        default: `scripts/extensions/third-party/st-chime/assets/default/true.mp3`,
        doubao: `scripts/extensions/third-party/st-chime/assets/doubao/true.mp3`,
    },

    // 从 localStorage 加载设置
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
        // 检查之前是否已授予权限
        this.state.hasAudioPermission = localStorage.getItem(this.PERMISSION_KEY) === "granted";
    },

    // 合并自定义音效到配置中
    mergeCustomChimes() {
        this.state.customChimes.forEach(chime => {
            this.CHIME_CONFIG[chime.id] = chime.url;
        });
    },

    // 创建并渲染设置界面
    createSettingsUI() {
        const container = $(`
          <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
              <b>更多提醒铃声</b>
              <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
              <div class="chime-toggle-container">
                <label class="chime-toggle-label"><input id="chime_enabled" type="checkbox" /><strong>启用插件</strong></label>
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
                <div class="chime-audio-list" id="custom_audio_list"></div>
              </div>
            </div>
          </div>
        `);

        $("#extensions_settings").append(container);

        // 填充下拉选项
        const select = $("#chime_select");
        Object.keys(this.CHIME_CONFIG).forEach(key => {
            const name = this.state.customChimes.find(c => c.id === key)?.name || (key === 'default' ? '默认' : '豆包');
            select.append($("<option>").val(key).text(name));
        });
        
        this.updateCustomAudioList();

        // 初始化UI状态
        $("#chime_enabled").prop("checked", this.state.chimeEnabled.has("enabled"));
        $("#chime_select").val(this.state.chimeSelect);
        $("#chime_volume").val(this.state.chimeVolume);
        this.updateVolumeDisplay();
        this.updatePermissionStatus();

        // 绑定事件
        $("#chime_enabled").on("change.chime", this.onChimeEnabled.bind(this));
        $("#chime_select").on("change.chime", this.onChimeSelect.bind(this));
        $("#chime_test").on("click.chime", this.onChimeTest.bind(this));
        $("#chime_volume").on("input.chime", this.onChimeVolume.bind(this));
        $("#add_custom_audio").on("click.chime", this.addCustomAudio.bind(this));
        $(document).on("click.chime", ".chime-remove-button", this.removeCustomAudio.bind(this));
    },
    
    // 更新权限状态的界面提示
    updatePermissionStatus(msg = "", type = "info") {
        const el = $("#audio_permission_status");
        if (!msg) {
            el.text(this.state.hasAudioPermission ? "已获取音频权限，可自动播放" : "请点击“测试音效”按钮以激活声音");
            el.removeClass("chime-status-success chime-status-warning chime-status-error").addClass(this.state.hasAudioPermission ? "chime-status-success" : "chime-status-warning");
        } else {
            el.text(msg);
            el.removeClass("chime-status-success chime-status-warning chime-status-error").addClass(`chime-status-${type}`);
        }
    },

    // 播放提示音的核心函数
    playChimeSound() {
        if (!this.state.chimeEnabled.has("enabled") || !this.state.hasAudioPermission) {
            return;
        }

        // 确保音频上下文处于运行状态
        if (this.state.audioContext && this.state.audioContext.state === "suspended") {
            this.state.audioContext.resume();
        }

        const url = this.CHIME_CONFIG[this.state.chimeSelect];
        if (!url) {
            this.showNotification("音频URL无效", "error");
            return;
        }

        this.state.audioElement.src = url;
        const playPromise = this.state.audioElement.play();

        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error("Chime playback failed:", error);
                // 如果播放失败，很可能是权限意外丢失，重置状态让用户重新授权
                this.state.hasAudioPermission = false;
                localStorage.removeItem(this.PERMISSION_KEY);
                this.updatePermissionStatus("播放失败，请重试或检查浏览器设置", "error");
            });
        }
    },
    
    // 更新音量滑块的视觉效果
    updateVolumeDisplay() {
        const percent = Math.round(this.state.chimeVolume * 100);
        $("#volume_value").text(`${percent}%`);
        const slider = $("#chime_volume");
        slider.css("background", `linear-gradient(to right, var(--chime-accent) ${percent}%, var(--chime-bg-light) ${percent}%)`);
    },

    // --- 事件处理函数 ---

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
        if (this.state.audioElement) {
            this.state.audioElement.volume = this.state.chimeVolume;
        }
        this.updateVolumeDisplay();
        this.saveSettings();
    },

    // 点击测试按钮，这是获取权限和播放的关键
    async onChimeTest() {
        // 如果音频上下文还未创建（通常是第一次点击），则创建它
        if (!this.state.audioContext) {
            try {
                this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                // 某些严格的浏览器需要通过播放一个无声的buffer来彻底“解锁”
                if (this.state.audioContext.state === 'suspended') {
                    await this.state.audioContext.resume();
                }
            } catch (err) {
                this.updatePermissionStatus("无法初始化音频环境", "error");
                return;
            }
        }

        // 只要用户点击了测试，我们就认为他们授予了权限
        if (!this.state.hasAudioPermission) {
            this.state.hasAudioPermission = true;
            localStorage.setItem(this.PERMISSION_KEY, "granted");
            this.updatePermissionStatus("音频权限已激活！", "success");
        }
        
        this.playChimeSound();
    },
    
    // --- 自定义音频管理 ---

    addCustomAudio() {
        const name = $("#custom_audio_name").val().trim();
        const url = $("#custom_audio_url").val().trim();
        if (!name || !url) return this.showNotification("名称和URL不能为空", "error");
        try { new URL(url); } catch { return this.showNotification("请输入有效的URL", "error"); }
        if (this.state.customChimes.some(c => c.name === name)) return this.showNotification("已存在同名音频", "error");

        const id = "custom_" + Date.now();
        this.state.customChimes.push({ id, name, url });
        this.CHIME_CONFIG[id] = url;
        
        $("#chime_select").append($("<option>").val(id).text(name));
        this.updateCustomAudioList();

        $("#custom_audio_name").val("");
        $("#custom_audio_url").val("");
        this.saveSettings();
        this.showNotification("音频已添加", "success");
    },
    
    removeCustomAudio(e) {
        const id = $(e.currentTarget).closest(".chime-audio-item").data("id");
        this.state.customChimes = this.state.customChimes.filter(c => c.id !== id);
        delete this.CHIME_CONFIG[id];

        $(`#chime_select option[value="${id}"]`).remove();
        this.updateCustomAudioList();

        if (this.state.chimeSelect === id) {
            this.state.chimeSelect = "default";
            $("#chime_select").val(this.state.chimeSelect);
        }
        this.saveSettings();
        this.showNotification("音频已删除", "success");
    },
    
    updateCustomAudioList() {
        const list = $("#custom_audio_list");
        list.empty();
        if (this.state.customChimes.length > 0) {
            this.state.customChimes.forEach(chime => {
                list.append(`
                  <div class="chime-audio-item" data-id="${chime.id}">
                    <span class="chime-audio-name">${chime.name}</span>
                    <span class="chime-audio-url">${chime.url}</span>
                    <button class="chime-remove-button"><i class="fa-solid fa-trash mr-1"></i>删除</button>
                  </div>
                `);
            });
        } else {
            list.append('<div class="chime-empty-list text-gray-500 text-sm">暂无自定义音频</div>');
        }
    },

    // 保存设置到 localStorage
    saveSettings() {
        const settingsToSave = {
            chimeEnabled: Array.from(this.state.chimeEnabled),
            chimeSelect: this.state.chimeSelect,
            chimeVolume: this.state.chimeVolume,
            customChimes: this.state.customChimes
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settingsToSave));
        saveSettingsDebounced();
    },
    
    // 显示一个短暂的通知
    showNotification(msg, type) {
        const notify = $(`<div class="chime-notification chime-status-${type}">${msg}</div>`);
        $("body").append(notify);
        setTimeout(() => notify.addClass("chime-show"), 10);
        setTimeout(() => {
            notify.removeClass("chime-show");
            setTimeout(() => notify.remove(), 300);
        }, 3000);
    },

    // 处理新消息事件，触发铃声
    handleNewMessageEvent() {
        if (this.state.chimeEnabled.has("enabled") && this.state.hasAudioPermission) {
            this.playChimeSound();
        }
    },

    // 插件入口
    init() {
        this.initSettings();
        this.mergeCustomChimes();

        // 创建并配置唯一的Audio元素
        this.state.audioElement = new Audio();
        this.state.audioElement.volume = this.state.chimeVolume;
        
        const btn = $("#chime_test");
        this.state.audioElement.onplay = () => btn.addClass("animate-pulse");
        this.state.audioElement.onpause = () => btn.removeClass("animate-pulse");
        this.state.audioElement.onended = () => btn.removeClass("animate-pulse");

        // 必须在DOM加载后执行
        jQuery(async () => {
            this.createSettingsUI();
            eventSource.on(event_types.MESSAGE_RECEIVED, this.handleNewMessageEvent.bind(this));
        });
    }
};

ChimePlugin.init();