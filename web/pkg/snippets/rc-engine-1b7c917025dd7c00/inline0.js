
        export function rerac_dev_env(name) {
            const p = window.__reracEnv || (window.__reracEnv = new URLSearchParams(window.location.search));
            const v = p.get(name);
            return v === null ? undefined : String(v);
        }
        export function rerac_take_skip() {
            const v = window.__reracSkipRequested === true;
            window.__reracSkipRequested = false;
            return v;
        }
        export function rerac_scene_active(on) {
            document.body.classList.toggle('cutscene', !!on);
        }
        export function rerac_movie_active(on) {
            document.body.classList.toggle('movie', !!on);
        }
        export function rerac_local_time() {
            const d = new Date();
            return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].join(',');
        }
        export function rerac_audio_frame(samples) {
            window.__reracAudio?.schedule(samples);
        }
        export function rerac_audio_queued() {
            return window.__reracAudio?.queuedSamples() || 0;
        }
        export function rerac_audio_underruns() {
            return window.__reracAudio?.underruns() || 0;
        }
        export function rerac_save_display_settings(aspect, resolution, fullscreen) {
            try {
                const key = 'rerac.launcher.settings.v1';
                const settings = JSON.parse(localStorage.getItem(key) || '{}');
                settings.aspect = aspect;
                settings.resolution = resolution;
                settings.fullscreen = fullscreen ? 'on' : 'off';
                localStorage.setItem(key, JSON.stringify(settings));
            } catch (e) {
                console.warn('display: could not save browser settings', e);
            }
        }
