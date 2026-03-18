import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { config } from './config.js';
import { i18n } from './translations.js';

const db = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
let chart = null;

const app = {
    user: null, txns: [], curMonth: 'all', isAdmin: false,
    lang: 'cs', curr: 'Kč', theme: localStorage.getItem('theme') || 'light',
    defCats: ["Jídlo 🍕", "Běžné 🏠", "Blbosti 🛍️", "Spoření 💰"],

    async start() {
        this.applyTheme();
        this.setupEventListeners();
        const { data: { session } } = await db.auth.getSession();
        if (session) await this.handleAuth(session.user);
        else document.getElementById('authSection').classList.remove('hidden');
    },

    setupEventListeners() {
        const click = (id, fn) => { const el = document.getElementById(id); if(el) el.onclick = fn; };
        click('loginBtn', () => this.login());
        click('logoutBtn', () => this.logout());
        click('themeBtn', () => this.cycleTheme());
        click('openSettings', () => this.showModal('settingsOverlay'));
        click('closeSettings', () => this.hideModal('settingsOverlay'));
        click('openAdmin', () => this.showAdmin());
        click('closeAdmin', () => this.hideModal('adminOverlay'));
        click('saveTxnBtn', () => this.saveTxn());
        click('addCatBtn', () => this.addCat());
    },

    async handleAuth(authUser) {
        this.user = authUser;
        const { data: profile } = await db.from('app_users').select('*').eq('id', authUser.id).maybeSingle();
        if (profile) {
            this.curr = profile.currency || this.curr;
            this.isAdmin = (profile.role === 'admin');
            this.user.custom_categories = profile.custom_categories || this.defCats;
        }
        this.init();
    },

    init() {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('mainSection').classList.remove('hidden');
        if (this.isAdmin) document.getElementById('openAdmin').classList.remove('hidden');
        document.getElementById('userLabel').innerText = this.user.email;
        document.getElementById('txnDate').value = new Date().toISOString().slice(0,10);
        this.renderCats();
        this.loadTxns();
    },

    async login() {
        const { data, error } = await db.auth.signInWithPassword({ 
            email: document.getElementById('loginUser').value, 
            password: document.getElementById('loginPass').value 
        });
        if (error) alert(error.message); else this.handleAuth(data.user);
    },

    async logout() { await db.auth.signOut(); location.reload(); },

    showModal(id) { document.getElementById(id).classList.remove('hidden'); },
    hideModal(id) { document.getElementById(id).classList.add('hidden'); },

    async showAdmin() {
        this.showModal('adminOverlay');
        const { count: uCount } = await db.from('app_users').select('*', { count: 'exact', head: true });
        const { count: tCount } = await db.from('transactions').select('*', { count: 'exact', head: true });
        document.getElementById('statUsers').innerText = uCount;
        document.getElementById('statTxns').innerText = tCount;

        const { data: users } = await db.from('app_users').select('id, role');
        document.getElementById('adminUserList').innerHTML = users.map(u => `
            <div class="txn-item">
                <small>${u.id.slice(0,8)}... (${u.role})</small>
                <button onclick="alert('Reset')" style="width:auto; padding:2px 10px">Reset</button>
            </div>`).join('');
    },

    async loadTxns() {
        const { data } = await db.from('transactions').select('*').eq('user_id', this.user.id).order('date', {ascending: false});
        this.txns = data || [];
        this.updateUI();
    },

    updateUI() {
        const total = this.txns.reduce((a, b) => a + b.amount, 0);
        document.getElementById('balToday').innerText = `${total.toLocaleString()} ${this.curr}`;
        
        const filtered = this.curMonth === 'all' ? this.txns : this.txns.filter(t => t.date.slice(0,7) === this.curMonth);
        
        document.getElementById('txnList').innerHTML = filtered.map(t => `
            <div class="txn-item">
                <span><b>${t.description}</b><br><small>${t.date} • ${t.category}</small></span>
                <span style="color:${t.amount>0?'var(--income)':'var(--expense)'}">${t.amount} ${this.curr}</span>
            </div>`).join('');
        
        this.updateChart(filtered);
    },

    async saveTxn() {
        const amt = parseFloat(document.getElementById('txnAmt').value);
        const desc = document.getElementById('txnDesc').value;
        if (!desc || isNaN(amt)) return;
        await db.from('transactions').insert([{ 
            user_id: this.user.id, amount: amt, description: desc, 
            category: document.getElementById('txnCat').value, 
            date: document.getElementById('txnDate').value 
        }]);
        this.loadTxns();
    },

    renderCats() {
        const cats = this.user.custom_categories || this.defCats;
        document.getElementById('txnCat').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
        document.getElementById('catEditor').innerHTML = cats.map((c, i) => `
            <div style="display:flex; gap:5px"><input value="${c}" onchange="app.editCat(${i}, this.value)"></div>
        `).join('');
    },
    async editCat(i, v) { this.user.custom_categories[i] = v; await this.savePref(); },
    async addCat() { this.user.custom_categories.push("Nová"); await this.savePref(); this.renderCats(); },
    async savePref() { await db.from('app_users').update({ custom_categories: this.user.custom_categories }).eq('id', this.user.id); },

    updateChart(list) {
        const ctx = document.getElementById('myChart'); if(!ctx) return;
        const data = {}; list.filter(t => t.amount < 0).forEach(t => data[t.category] = (data[t.category]||0) + Math.abs(t.amount));
        if(chart) chart.destroy();
        chart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'] }] }, options: { plugins: { legend: { display:false } } } });
    },

    cycleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : (this.theme === 'dark' ? 'amoled' : 'light');
        localStorage.setItem('theme', this.theme); this.applyTheme();
    },
    applyTheme() {
        document.body.classList.remove('dark', 'amoled');
        if (this.theme !== 'light') document.body.classList.add(this.theme);
    }
};

window.app = app;
app.start();
