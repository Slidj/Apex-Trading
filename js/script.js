const tg = window.Telegram.WebApp;
tg.expand();
tg.setHeaderColor('#131722');

const CONFIG = {
    up: '#0faf59', down: '#ff4a68', bg: '#131722', grid: 'rgba(255,255,255,0.03)',
    bet: '#ffcf00'
};

// --- AUDIO SYSTEM ---
const sounds = {
    click: document.getElementById('sound-click'),
    win: document.getElementById('sound-win'),
    loss: document.getElementById('sound-loss')
};

function playSound(type) {
    if (sounds[type]) {
        sounds[type].currentTime = 0;
        sounds[type].volume = 0.5; 
        sounds[type].play().catch(e => console.log('Audio autoplay blocked', e));
    }
}

// --- USER DATA ---
const user = tg.initDataUnsafe.user;
if (user) {
    document.getElementById('user-name').innerText = user.first_name || 'Trader';
    if (user.photo_url) document.getElementById('user-avatar').src = user.photo_url;
}

// --- STATE ---
let currentChartTF = 1; 
let tradeDuration = 30; 
let tradeAmount = 50;
let lastPrice = 0; // РЕАЛЬНА ціна (Raw)
let balance = 1000;
let currentSymbol = 'btcusdt';

// --- CHART INIT ---
const container = document.getElementById('chart-container');
const chart = LightweightCharts.createChart(container, {
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#787b86', fontSize: 11 },
    grid: { vertLines: { color: CONFIG.grid }, horzLines: { color: CONFIG.grid } },
    priceScale: { autoScale: true, scaleMargins: { top: 0.2, bottom: 0.2 } },
    timeScale: { timeVisible: true, secondsVisible: true, barSpacing: 12, minBarSpacing: 5, borderColor: 'transparent' },
    crosshair: { mode: 1, vertLine: { style: 3, width: 1, color: '#555' }, horzLine: { style: 3, width: 1, color: '#555' } }
});

const series = chart.addCandlestickSeries({
    upColor: CONFIG.up, borderUpColor: CONFIG.up, wickUpColor: CONFIG.up,
    downColor: CONFIG.down, borderDownColor: CONFIG.down, wickDownColor: CONFIG.down,
});

// Лінія реальної ціни (Bid line) - показує де реально ринок
const realPriceLine = series.createPriceLine({
    price: 0,
    color: 'rgba(255, 255, 255, 0.4)',
    lineWidth: 1,
    lineStyle: 2, // Punkter
    axisLabelVisible: false, // Не засмічуємо вісь, тільки візуально на графіку
    title: '',
});

window.onresize = () => chart.resize(container.clientWidth, container.clientHeight);
window.resetZoom = () => chart.timeScale().scrollToRealTime();

// --- SENTIMENT LOGIC (SIMULATION) ---
function updateSentiment(price, prevPrice) {
    let buyPercent = 50;
    
    if (prevPrice > 0) {
        const delta = price - prevPrice;
        const noise = (Math.random() - 0.5) * 15; // Трохи хаосу
        
        // Реакція на рух ціни
        if (delta > 0) buyPercent = 60 + (delta * 500) + noise;
        else buyPercent = 40 + (delta * 500) + noise;
    }

    // Обмеження 10% - 90%
    buyPercent = Math.max(10, Math.min(90, buyPercent));
    const sellPercent = 100 - buyPercent;

    // Оновлюємо UI (перевіряємо чи елементи існують в HTML)
    const elUp = document.getElementById('sentiment-up');
    const elDown = document.getElementById('sentiment-down');
    
    if (elUp && elDown) {
        elUp.style.height = `${buyPercent}%`;
        elDown.style.height = `${sellPercent}%`;
    }
}

// --- DATA STREAM ---
let ws = null;
let rawCandle = null;
let haCandle = null;
let prevHaCandle = null;

function connectWebSocket(symbol) {
    if (ws) ws.close();
    series.setData([]);
    rawCandle = null; haCandle = null; prevHaCandle = null;
    currentSymbol = symbol;

    ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@aggTrade`);
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const price = parseFloat(data.p);
        const time = Math.floor(data.T / (currentChartTF * 1000)) * currentChartTF;

        // Оновлюємо Sentiment
        if (lastPrice > 0) updateSentiment(price, lastPrice);

        // Оновлюємо глобальну реальну ціну
        lastPrice = price; 

        // 1. Формуємо звичайну свічку (Raw)
        if (!rawCandle || time > rawCandle.time) {
            if (haCandle) prevHaCandle = { ...haCandle };
            rawCandle = { time: time, open: rawCandle ? rawCandle.close : price, high: price, low: price, close: price };
        } else {
            rawCandle.high = Math.max(rawCandle.high, price);
            rawCandle.low = Math.min(rawCandle.low, price);
            rawCandle.close = price;
        }

        // 2. Рахуємо Heikin Ashi (Для краси графіка)
        let haOpen = rawCandle.open;
        if (prevHaCandle) {
            haOpen = (prevHaCandle.open + prevHaCandle.close) / 2;
        }
        
        const haClose = (rawCandle.open + rawCandle.high + rawCandle.low + rawCandle.close) / 4;
        const haHigh = Math.max(rawCandle.high, haOpen, haClose);
        const haLow = Math.min(rawCandle.low, haOpen, haClose);

        haCandle = { time: time, open: haOpen, high: haHigh, low: haLow, close: haClose };

        // 3. Оновлюємо графік
        series.update(haCandle);
        
        // 4. Оновлюємо лінію реальної ціни
        realPriceLine.applyOptions({ price: lastPrice });

        // 5. UI
        const digits = price < 1 ? 5 : 2; 
        series.applyOptions({ priceFormat: { precision: digits, minMove: 1/Math.pow(10, digits) } });
    };
}
connectWebSocket('btcusdt');

// --- CONTROLS LOGIC ---
window.setChartTF = (seconds, btn) => {
    currentChartTF = seconds;
    series.setData([]); rawCandle = null;
    document.querySelectorAll('.control-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if(tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
};

window.toggleSelector = (id) => {
    const el = document.getElementById(id);
    const isVisible = el.classList.contains('show');
    document.querySelectorAll('.selector-overlay').forEach(s => s.classList.remove('show'));
    if (!isVisible) el.classList.add('show');
};

window.setAsset = (symbol, name, payout) => {
    document.getElementById('current-asset').innerHTML = `${name} <span style="font-size:10px">▼</span>`;
    document.getElementById('current-payout').innerText = `${payout} payout`;
    
    document.querySelectorAll('#asset-selector .select-option').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    toggleSelector('asset-selector');
    connectWebSocket(symbol);
    if(tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
};

window.setTradeTime = (seconds) => {
    tradeDuration = seconds;
    const min = Math.floor(seconds / 60).toString().padStart(2, '0');
    const sec = (seconds % 60).toString().padStart(2, '0');
    document.getElementById('time-display').innerText = `${min}:${sec}`;
    document.querySelectorAll('#time-selector .select-option').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    toggleSelector('time-selector');
};

window.setTradeAmount = (amount) => {
    tradeAmount = amount;
    document.getElementById('amount-display').innerText = `$${amount}`;
    document.querySelectorAll('#amount-selector .select-option').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    toggleSelector('amount-selector');
};

// --- TRADING LOGIC (REALISM + SOUNDS) ---
window.startTrade = (direction) => {
    playSound('click');
    if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    
    // Ставка по РЕАЛЬНІЙ ціні (lastPrice)
    const entryPrice = lastPrice;
    const endTime = Date.now() + (tradeDuration * 1000);
    
    const color = CONFIG.bet; 
    const arrow = direction === 'UP' ? '▲' : '▼';
    
    const line = series.createPriceLine({
        price: entryPrice, color: color, lineWidth: 2, lineStyle: 2,
        title: `${arrow} $${tradeAmount}`,
        axisLabelVisible: true,
        axisLabelColor: color,
        axisLabelTextColor: '#000000'
    });

    const interval = setInterval(() => {
        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        
        if (remaining <= 0) {
            clearInterval(interval);
            finishTrade(line, direction, entryPrice);
        } else {
            line.applyOptions({ title: `${arrow} ${remaining}s` });
        }
    }, 1000);
};

function finishTrade(line, direction, entryPrice) {
    let win = false;
    
    // Порівняння з реальною ціною в момент закриття
    if (direction === 'UP' && lastPrice > entryPrice) win = true;
    else if (direction === 'DOWN' && lastPrice < entryPrice) win = true;

    const payoutRate = parseFloat(document.getElementById('current-payout').innerText) / 100;
    const profit = tradeAmount * payoutRate;
    
    if (win) {
        balance += profit;
        playSound('win');
    } else {
        balance -= tradeAmount;
        playSound('loss');
    }
    
    document.getElementById('balance').innerText = `$${balance.toFixed(2)}`;
    series.removePriceLine(line);
    showResult(win, win ? profit : tradeAmount);
}

function showResult(win, amount) {
    const modal = document.getElementById('result-modal');
    const title = document.getElementById('res-title');
    const val = document.getElementById('res-val');

    title.innerText = win ? 'PROFIT' : 'LOSS';
    title.style.color = win ? CONFIG.up : CONFIG.down;
    val.innerText = (win ? '+' : '-') + `$${amount.toFixed(2)}`;
    val.style.color = win ? CONFIG.up : CONFIG.down;
    
    modal.style.borderColor = win ? CONFIG.up : CONFIG.down;
    modal.classList.add('show');

    if(tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(win ? 'success' : 'error');
    setTimeout(() => { modal.classList.remove('show'); }, 2000);
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.input-group') && !e.target.closest('.asset-btn') && !e.target.closest('.selector-overlay')) {
        document.querySelectorAll('.selector-overlay').forEach(s => s.classList.remove('show'));
    }
});
