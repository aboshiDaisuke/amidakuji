const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

// Run the actual inline application script with a small DOM/canvas adapter and
// virtual time. No CDN access or browser dependencies are needed for these tests.
const source = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')
    .match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\binit\(\);\s*$/, '');

function app() {
    const elements = new Map();
    const storage = new Map();
    const tasks = new Map();
    let now = 0;
    let nextId = 0;
    const drawing = new Proxy({}, { get: (obj, key) => obj[key] || (() => {}) });
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set(['game-panel', 'summary-modal', 'alcohol-modal', 'jackpot-video-layer'].includes(id) ? ['hidden'] : []);
            const el = {
                value: '', checked: false, textContent: '', innerHTML: '', children: [],
                style: { setProperty() {} }, offsetWidth: 800, clientWidth: 800,
                classList: {
                    add: (...values) => values.forEach(value => classes.add(value)),
                    remove: (...values) => values.forEach(value => classes.delete(value)),
                    contains: value => classes.has(value),
                    toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value)
                },
                getContext: () => drawing,
                addEventListener() {}, removeEventListener() {}, setAttribute() {},
                appendChild(child) { this.children.push(child); },
                replaceChildren() { this.children = []; },
                insertAdjacentHTML(_, html) { this.innerHTML += html; },
                setCustomValidity(message) { this.validationMessage = message; },
                reportValidity() {}, focus() {}, scrollIntoView() {}, remove() {}, pause() {}, load() {},
                play: () => Promise.resolve(),
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 640 })
            };
            elements.set(id, el);
        }
        return elements.get(id);
    }
    function schedule(fn, delay) {
        const id = ++nextId;
        tasks.set(id, { fn, at: now + delay });
        return id;
    }
    const window = { innerHeight: 1180, devicePixelRatio: 2, addEventListener() {}, matchMedia: () => ({ matches: false }) };
    const context = vm.createContext({
        console, window, navigator: {}, confirm: () => true,
        document: { getElementById: element, querySelector: element, createElement: () => element(Symbol()), addEventListener() {}, body: element('body') },
        localStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k) || null, removeItem: k => storage.delete(k) },
        performance: { now: () => now },
        setTimeout: schedule, clearTimeout: id => tasks.delete(id), setInterval() {},
        requestAnimationFrame: fn => schedule(() => fn(now), 16), cancelAnimationFrame: id => tasks.delete(id)
    });
    vm.runInContext(source, context);
    return {
        run: code => vm.runInContext(code, context), element, window,
        advance(ms) {
            const until = now + ms;
            while (true) {
                const next = [...tasks.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                const [id, task] = next;
                tasks.delete(id);
                now = task.at;
                task.fn();
            }
            now = until;
        }
    };
}

function namesAt(a, expression) {
    return JSON.parse(a.run(`JSON.stringify(${expression}.map(prize => prize.name))`));
}

test('invalid counts are rejected and valid counts persist unchanged', () => {
    const a = app();
    a.element('bulk-name').value = 'クッキー';
    for (const value of ['', '0', '-1', '1.5', '1001', 'Infinity', 'nope']) {
        a.element('bulk-count').value = value;
        a.run('addBulkItem()');
        assert.equal(a.run('bulkItems.length'), 0);
    }
    a.element('bulk-count').value = '2';
    a.run('addBulkItem(); applyLoadedSetup(loadAppState())');
    assert.equal(a.run('expandPrizeItems().length'), 2);
});

test('same-name prizes keep independent attributes in results and saved games', () => {
    const a = app();
    a.run(`currentCount=2; bulkItems=[{name:'景品',count:1,isAlcohol:true,isJackpot:true},{name:'景品',count:1,isPlush:true}]; generateAmida(); restoreGameSession(loadAppState());`);
    a.advance(50);
    assert.equal(a.run(`resultBundles.filter(bundle=>bundleHasKind(bundle,['alcohol'])).length`), 1);
    assert.equal(a.run(`resultBundles.filter(bundle=>bundleHasKind(bundle,['plush'])).length`), 1);
    assert.equal(a.run('resultBundles.filter(bundleHasJackpot).length'), 1);
    assert.equal(a.run('groupBundleItems(resultBundles.flat()).length'), 2);
});

test('declining swaps only unopened bundles when a safe replacement exists', () => {
    const a = app();
    a.run(`currentCount=3; generateAmida(); horizontalLines=[];
        resultBundles=[[normalizePrize({name:'ビール',isAlcohol:true})],[normalizePrize({name:'お茶'})],[normalizePrize({name:'クッキー'})]];
        revealedResults=[false,true,false]; reassignChallengeAwayFrom(0,['alcohol']);`);
    assert.deepEqual(namesAt(a, 'resultBundles[0]'), ['クッキー']);
    assert.deepEqual(namesAt(a, 'resultBundles[1]'), ['お茶']);
    assert.deepEqual(namesAt(a, 'resultBundles[2]'), ['ビール']);
});

test('without a safe replacement, only declined items are withheld and persisted', () => {
    const a = app();
    a.run(`currentCount=2; generateAmida(); horizontalLines=[];
        resultBundles=[[normalizePrize({name:'ビール',isAlcohol:true}),normalizePrize({name:'クッキー'})],[]];
        revealed=[false,true]; revealedResults=[false,true]; animationDuration=20; startReveal(0,['alcohol']);`);
    a.advance(40);
    assert.deepEqual(namesAt(a, 'resultBundles[0]'), ['クッキー']);
    assert.deepEqual(namesAt(a, 'declinedBundles[0]'), ['ビール']);
    a.run('restoreGameSession(loadAppState()); showSummary()');
    assert.deepEqual(namesAt(a, 'declinedBundles[0]'), ['ビール']);
    assert.match(a.element('summary-unassigned').textContent, /未配布.*ビール/);
});

test('all participants may decline without losing or assigning restricted prizes', () => {
    const a = app();
    a.run(`currentCount=4; bulkItems=[{name:'ビール',count:4,isAlcohol:true}]; generateAmida(); animationDuration=20;`);
    for (let i = 0; i < 4; i++) {
        a.run(`startReveal(${i},['alcohol'])`);
        a.advance(40);
    }
    assert.equal(a.run('resultBundles.flat().length'), 0);
    assert.equal(a.run('declinedBundles.flat().length'), 4);
    assert.equal(a.run('revealed.every(Boolean)'), true);
});

test('a pending summary cannot disclose a reset draw or reopen on the setup screen', () => {
    const a = app();
    for (const action of ['resetPaths()', 'resetView()', 'clearSavedData()']) {
        a.run(`generateAmida(); revealAll(); ${action}`);
        a.advance(1600);
        assert.equal(a.element('summary-modal').classList.contains('hidden'), true);
    }
});

test('returning or clearing during animation cancels old result and persistence callbacks', () => {
    for (const action of ['resetView();generateAmida()', 'clearSavedData()']) {
        const a = app();
        a.run(`generateAmida(); startReveal(0,[]); ${action}`);
        a.advance(6000);
        assert.equal(a.run('paths.length'), 0);
        assert.equal(a.run('revealedResults.some(Boolean)'), false);
        if (action === 'clearSavedData()') assert.equal(a.run('loadAppState()'), null);
    }
});

test('returning during jackpot prelude cancels both video and old draw', () => {
    const a = app();
    a.run(`currentCount=2; bulkItems=[{name:'大当たり',count:2,isJackpot:true}]; generateAmida(); animationDuration=20; startReveal(0,[]);`);
    a.advance(16);
    assert.equal(a.element('jackpot-video-layer').classList.contains('hidden'), false);
    a.run('resetView(); bulkItems=[]; generateAmida()');
    a.advance(6000);
    assert.equal(a.element('jackpot-video-layer').classList.contains('hidden'), true);
    assert.equal(a.run('paths.length'), 0);
});

test('rotation updates completed and animating paths without changing destinations', () => {
    const a = app();
    a.run('generateAmida(); animationDuration=20; startReveal(1,[])');
    a.advance(40);
    const destination = a.run('paths[0].endIndex');
    a.element('.board-scroll').clientWidth = 1100;
    a.window.innerHeight = 820;
    a.run('resizeCanvas()');
    assert.equal(a.run('paths[0].coords[0].x===getColX(1)'), true);
    assert.equal(a.run('paths[0].endIndex'), destination);
    a.run('animationDuration=400; startReveal(2,[])');
    a.advance(100);
    a.element('.board-scroll').clientWidth = 700;
    a.window.innerHeight = 1180;
    a.run('resizeCanvas()');
    assert.equal(a.run('getAnimationPathInfo(activeAnimation).segments[0].start.x===getColX(2)'), true);
    a.advance(400);
    assert.equal(a.run('paths.every(path=>JSON.stringify(path.coords)===JSON.stringify(calculatePath(path.startIndex).coords))'), true);
});

test('legacy saves restore attributes and opened paths; older large games reopen setup at 20 people', () => {
    const a = app();
    a.run(`const legacy={version:1,currentCount:2,isPlaying:true,names:['1','2'],horizontalLines:[],resultBundles:[['ビール'],[]],alcoholNames:['ビール'],revealed:[true,false]};
        applyLoadedSetup(legacy); restoreGameSession(legacy);`);
    a.advance(50);
    assert.equal(a.run('resultBundles[0][0].isAlcohol'), true);
    assert.equal(a.run('paths.length'), 1);
    assert.equal(a.run('revealedResults[0]'), true);
    a.run('applyLoadedSetup({currentCount:100})');
    assert.equal(a.run('currentCount'), 20);
    assert.equal(a.run('canRestoreGame({...legacy,names:Array(100).fill("1"),resultBundles:Array(100).fill([])})'), false);
});

test('20-person board keeps 60px spacing and a bounded bitmap; participant count cannot exceed 20', () => {
    const a = app();
    a.run("currentCount=20; setDisplayMode('ipad'); generateAmida(); changeCount(1)");
    assert.equal(a.run('currentCount'), 20);
    assert.equal(a.run('getColX(1)-getColX(0)'), 60);
    assert.equal(a.element('participant-buttons').children.length, 20);
    assert.ok(a.element('amidaCanvas').width * a.element('amidaCanvas').height <= 8000000);
});

test('generated paths form a permutation and automatic distribution preserves every prize', () => {
    const a = app();
    for (const count of [2, 4, 10, 20]) {
        a.run(`currentCount=${count}; distributionMode='auto'; bulkItems=[{name:'景品',count:7,isAlcohol:true},{name:'景品',count:8,isPlush:true},{name:'お茶',count:9}]; generateAmida();`);
        assert.equal(a.run('new Set(names.map((_,i)=>calculatePath(i).endIndex)).size'), count);
        assert.equal(a.run('resultBundles.flat().length'), 24);
        assert.equal(a.run('resultBundles.flat().filter(prize=>prize.isAlcohol).length'), 7);
        assert.equal(a.run('resultBundles.flat().filter(prize=>prize.isPlush).length'), 8);
    }
});


test('display mode persists and can switch mid-animation without resetting the draw', () => {
    const a = app();
    a.run("currentCount=20; generateAmida(); animationDuration=400; startReveal(1,[])");
    a.advance(100);
    const before = a.run('JSON.stringify({horizontalLines,resultBundles,revealed})');
    a.run("setDisplayMode('ipad')");
    assert.equal(a.run('isAnimating'), true);
    assert.equal(a.run('JSON.stringify({horizontalLines,resultBundles,revealed})'), before);
    assert.equal(a.element('body').classList.contains('ipad-mode'), true);
    assert.equal(a.run('loadAppState().displayMode'), 'ipad');
    a.advance(400);
    assert.equal(a.run('paths.length'), 1);
    assert.equal(a.run('paths[0].coords[0].x===getColX(1)'), true);
    a.run("setDisplayMode('standard')");
    assert.equal(a.element('body').classList.contains('ipad-mode'), false);
    assert.equal(a.run('paths.length'), 1);
    assert.equal(a.run('loadAppState().displayMode'), 'standard');
    a.run("setDisplayMode('ipad'); applyLoadedSetup(loadAppState())");
    assert.equal(a.run('displayMode'), 'ipad');
});

test('registered prize counts can be changed in place within 1 and the maximum', () => {
    const a = app();
    a.run(`bulkItems=[{name:'クッキー',count:1}]; updateBulkList();`);
    a.run('changeBulkItemCount(0, 1)');
    assert.equal(a.run('bulkItems[0].count'), 2);
    assert.equal(a.run('loadAppState().bulkItems[0].count'), 2);
    a.run('changeBulkItemCount(0, -1); changeBulkItemCount(0, -1)');
    assert.equal(a.run('bulkItems[0].count'), 1);
    a.run('bulkItems[0].count = MAX_PRIZE_COUNT; changeBulkItemCount(0, 1)');
    assert.equal(a.run('bulkItems[0].count'), a.run('MAX_PRIZE_COUNT'));
    a.run('changeBulkItemCount(5, 1)');
    assert.equal(a.run('bulkItems.length'), 1);
    a.run('updateBulkList()');
    assert.match(a.element('bulk-list').children.at(-1).innerHTML, /changeBulkItemCount\(0, -1\)/);
});
