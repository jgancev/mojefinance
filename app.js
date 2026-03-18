import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { config } from './config.js';

const db = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
let chart = null;

const app = {
    user: null, txns: [], curMonth: 'all', isAdmin: false,
    curr: 'Kč', theme: localStorage.getItem('theme') || 'dark',
    defCats: ["Jídlo 🍕", "Běžné 🏠", "Nákupy 🛍️", "Ostatní ⚙️"],

    async start() {
        this.applyTheme();
        this.setupListeners();
        const { data: { session } } = await db.auth.getSession();
        if (session) await this.handleAuth(session.user);
        else document.getElementById('authSection').classList.remove('hidden');
    },

    setupListeners() {
        const get = (id) => document.getElementById(id);
        get('loginBtn').onclick = () => this.login();
        get('logoutBtn').onclick = () => this.logout();
        get('themeBtn').onclick = () => this.cycleTheme();
        get('openSettings').onclick = () => document.getElementById('settingsOverlay').classList.remove('hidden');
        get('closeSettings').onclick = () => document.getElementById('settingsOverlay').classList.add('hidden');
        get('openAdmin').onclick = () => this.showAdmin();
        get('closeAdmin').onclick = () => document.getElementById('adminOverlay').classList.add('hidden');
        get('saveExpBtn').onclick = () => this.saveTxn(false);
        get('saveIncBtn').onclick = () => this.saveTxn(true);
        get('addCatBtn').onclick = () => this.addCat();
        get('stCurr').onchange = (e) => this.updateCurr(e.target.value);
    },

    async handleAuth(authUser) {
        this.user = authUser;
        const { data: prof } = await db.from('app_users').select('*').eq('id', authUser.id).maybeSingle();
        if (prof) {
            this.isAdmin = (prof.role === 'admin');
            this.curr = prof.currency || 'Kč';
            this.user.custom_categories = prof.custom_categories || this.defCats;
        }
        this.init();
    },

    init() {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('mainSection').classList.remove('hidden');
        if (this.isAdmin) document.getElementById('openAdmin').classList.remove('hidden');
        document.getElementById('userLabel').innerText = this.user.email;
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

    // ADMIN LOGIKA
    async verifyAdmin() {
        const pass = prompt("Potvrďte akci svým admin heslem:");
        if (!pass) return false;
        const { error } = await db.auth.signInWithPassword({ email: this.user.email, password: pass });
        return !error;
    },

    async showAdmin() {
        document.getElementById('adminOverlay').classList.remove('hidden');
        const { data: users } = await db.from('app_users').select('*');
        const list = document.getElementById('adminUserList');
        
        list.innerHTML = (users || []).map(u => `
            <div class="txn-item">
                <span style="font-size:0.9rem"><b>${u.email || u.id.slice(0,8)}</b></span>
                <div style="display:flex; gap:5px">
                    <button onclick="app.adminAction('${u.id}', 'reset')" style="width:auto; padding:5px 10px; background:var(--primary); font-size:0.7rem">Reset Hesla</button>
                    <button onclick="app.adminAction('${u.id}', 'delete')" style="width:auto; padding:5px 10px; background:var(--expense); font-size:0.7rem">Smazat</button>
                </div>
            </div>
        `).join('');
    },

    async adminAction(uid, type) {
        if (!await this.verifyAdmin()) { alert("Ověření selhalo."); return; }
        if (type === 'delete' && confirm("Smazat uživatele?")) {
            await db.from('app_users').delete().eq('id', uid);
            this.showAdmin();
        } else if (type === 'reset') {
            const { data } = await db.from('app_users').select('email').eq('id', uid).single();
            await db.auth.resetPasswordForEmail(data.email);
            alert("Reset e-mail odeslán uživateli " + data.email);
        }
    },

    // OSTATNÍ LOGIKA (TXNS, CHART ATD.)
    async loadTxns() {
        const { data } = await db.from('transactions').select('*').eq('user_id', this.user.id).order('date', {ascending: false});
        this.txns = data || [];
        this.updateUI();
    },

    updateUI() {
        const now = new Date().toISOString().slice(0,10);
        const total = this.txns.filter(t => t.date <= now).reduce((a, b) => a + b.amount, 0);
        document.getElementById('balToday').innerText = `${total.toLocaleString()} ${this.curr}`;
        const filtered = this.curMonth === 'all' ? this.txns : this.txns.filter(t => t.date.slice(0,7) === this.curMonth);
        document.getElementById('txnList').innerHTML = filtered.map(t => `
            <div class="txn-item">
                <span><b>${t.description}</b><br><small>${t.date}</small></span>
                <span style="color:${t.amount>0?'var(--income)':'var(--expense)'}">${t.amount.toLocaleString()}</span>
            </div>`).join('');
        this.renderMonthChips();
        this.updateChart(filtered);
    },

    renderMonthChips() {
        const months = ['all', ...new Set(this.txns.map(t => t.date.slice(0,7)).sort().reverse())];
        document.getElementById('monthChips').innerHTML = months.map(m => `
            <span class="chip ${this.curMonth===m?'selected':''}" onclick="app.setMonth('${m}')">${m}</span>`).join('');
    },
    setMonth(m) { this.curMonth = m; this.updateUI(); },

    async saveTxn(isInc) {
        const pre = isInc ? 'inc' : 'exp';
        const amt = parseFloat(document.getElementById(pre+'Amt').value);
        const desc = document.getElementById(pre+'Desc').value;
        if (!desc || isNaN(amt)) return;
        await db.from('transactions').insert([{
            user_id: this.user.id, amount: isInc?amt:-amt, description: desc,
            category: isInc?'Příjem':document.getElementById('expCat').value,
            date: document.getElementById(pre+'Date').value
        }]);
        this.loadTxns();
    },

    renderCats() {
        const cats = this.user.custom_categories || this.defCats;
        document.getElementById('expCat').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
        document.getElementById('catEditor').innerHTML = cats.map((c, i) => `
            <div style="display:flex; gap:5px; margin-bottom:5px"><input value="${c}" onchange="app.editCat(${i}, this.value)"></div>`).join('');
    },
    async editCat(i, v) { this.user.custom_categories[i] = v; await this.savePref(); },
    async addCat() { this.user.custom_categories.push("Nová"); await this.savePref(); this.renderCats(); },
    async updateCurr(v) { this.curr = v; await this.savePref(); this.updateUI(); },
    async savePref() { await db.from('app_users').update({ custom_categories: this.user.custom_categories, currency: this.curr }).eq('id', this.user.id); },

    updateChart(list) {
        const ctx = document.getElementById('myChart');
        const data = {}; list.filter(t => t.amount < 0).forEach(t => data[t.category] = (data[t.category] || 0) + Math.abs(t.amount));
        if (chart) chart.destroy();
        chart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: ['#0081ff', '#10b981', '#f59e0b', '#ef4444'] }] }, options: { plugins: { legend: { display: false } } } });
    },

    cycleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : (this.theme === 'dark' ? 'amoled' : 'light');
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
    },
    applyTheme() {
        document.body.classList.remove('dark', 'amoled');
        if (this.theme !== 'light') document.body.classList.add(this.theme);
        document.getElementById('themeBtn').innerText = `🌓 Mode: ${this.theme}`;
    }
};

window.app = app;
app.start();
