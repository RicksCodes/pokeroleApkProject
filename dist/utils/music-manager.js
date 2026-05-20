const MusicManager = (() => {
    let _audio = null;
    let _currentSrc = '';
    let _fadeTimer = null;
    let _pausedByHide = false;
    const TARGET_VOL = 0.5;
    const BASE = 'utils/themes/';

    document.addEventListener('visibilitychange', () => {
        if (!_audio) return;
        if (document.hidden) {
            if (!_audio.paused) {
                _clearFade();
                _audio.pause();
                _pausedByHide = true;
            }
        } else if (_pausedByHide) {
            _audio.play().catch(() => {});
            _pausedByHide = false;
        }
    });

    function _getBadgeCount() {
        try {
            const id = sessionStorage.getItem('currentTrainerId');
            if (!id) return 0;
            const trainers = JSON.parse(localStorage.getItem('pokeRole_Trainers') || '[]');
            const t = trainers.find(x => String(x.id) === String(id));
            return t?.badges?.length ?? 0;
        } catch { return 0; }
    }

    function _trackPath(screen) {
        const has8 = _getBadgeCount() >= 8;
        switch (screen) {
            case 'index':   return BASE + 'index/DriftveilCity.mp3';
            case 'trainer': return has8 ? BASE + 'trainer/got8badges/HallOfFame.mp3'    : BASE + 'trainer/MtCoronet.mp3';
            case 'lobby':   return has8 ? BASE + 'lobby/got8badges/ChampionCynthia.mp3' : BASE + 'lobby/Rival.mp3';
            case 'battle':  return has8 ? BASE + 'battle/got8badges/Battle(Champion).mp3'  : BASE + 'battle/Battle(EliteFour).mp3';
            case 'victory': return has8 ? BASE + 'battle/got8badges/Victory(Champion).mp3' : BASE + 'battle/Victory(EliteFour).mp3';
            default: return null;
        }
    }

    function _clearFade() {
        if (_fadeTimer) { clearInterval(_fadeTimer); _fadeTimer = null; }
    }

    function stop() {
        _clearFade();
        if (!_audio) return;
        const a = _audio;
        _audio = null;
        _currentSrc = '';
        _fadeTimer = setInterval(() => {
            a.volume = Math.max(0, a.volume - 0.05);
            if (a.volume <= 0) {
                clearInterval(_fadeTimer);
                _fadeTimer = null;
                a.pause();
            }
        }, 50);
    }

    function play(src, loop = true) {
        if (_currentSrc === src) return;
        _clearFade();
        if (_audio) { _audio.pause(); _audio = null; }
        _currentSrc = src;
        const a = new Audio(src);
        a.loop = loop;
        a.volume = 0;
        _audio = a;
        a.play().catch(() => {});
        let vol = 0;
        _fadeTimer = setInterval(() => {
            vol = Math.min(vol + 0.05, TARGET_VOL);
            a.volume = vol;
            if (vol >= TARGET_VOL) { clearInterval(_fadeTimer); _fadeTimer = null; }
        }, 50);
    }

    function playForScreen(screen) {
        const src = _trackPath(screen);
        if (!src) return;
        play(src, screen !== 'victory');
    }

    return { play, stop, playForScreen };
})();
