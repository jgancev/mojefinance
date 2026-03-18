import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { config } from './config.js';

const db = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
let chart = null;

const app = {
    user: null, txns: [], curMonth: 'all', isAdmin: false,
    curr: 'Kč', defCats: ["Jídlo 🍕", "Běžné 🏠", "Zábava 🎈", "Ostatní ⚙️"],

    async start() {
        this.setupEvents();
        const { data: { session } } = await db.auth.getSession();
        if (session) await this.handleAuth(session.user);
        else document.getElementById('authSection').classList.remove('hidden');
    },

    setupEvents() {
        const get = (id) => document.getElementById(id);
        get('loginBtn').onclick = () => this.login();
        get('logoutBtn').onclick = () => this.logout();
        get('openSettings').onclick = () => this.showModal('settingsOverlay');
        get('closeSettings').onclick = () => this.hideModal('settingsOverlay');
        get('openAdmin').onclick = () => this.showAdmin();
        get('closeAdmin').onclick = () => this.hideModal('adminOverlay');
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
        const today = new Date().toISOString().slice(0,10);
        document.getElementById('expDate').value = today;
        document.getElementById('incDate').value = today;
        this.renderCats();
        this.loadTxns();
    },

    async login() {
        const email = document.getElementById('loginUser').value;
        const pass = document.getElementById('loginPass').value;
        const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
        if (error) alert(error.message); else this.handleAuth(data.user);
    },

    async logout() { await db.auth.signOut(); location.reload(); },
    showModal(id) { document.getElementById(id).classList.remove('hidden'); },
    hideModal(id) { document.getElementById(id).classList.add('hidden'); },

    async loadTxns() {
        const { data } = await db.from('transactions').select('*').eq('user_id', this.user.id).order('date', {ascending: false});
        this.txns = data || [];
        this.updateUI();
    },

    updateUI() {
        const now = new Date().toISOString().slice(0,10);
        const total = this.txns.reduce((a, b) => a + b.amount, 0);
        const todayBal = this.txns.filter(t => t.date <= now).reduce((a, b) => a + b.amount, 0);
        
        document.getElementById('balToday').innerText = `${todayBal.toLocaleString()} ${this.curr}`;
        document.getElementById('balFuture').innerText = `${total.toLocaleString()} ${this.curr}`;
        
        const filtered = this.curMonth === 'all' ? this.txns : this.txns.filter(t => t.date.slice(0,7) === this.curMonth);
        
        // Historie list
        document.getElementById('txnList').innerHTML = filtered.map(t => `
            <div class="txn-item">
                <span><b>${t.description}</b><br><small>${t.date} • ${t.category}</small></span>
                <span style="color:${t.amount>0?'var(--green)':'var(--red)'}">
                    ${t.amount > 0 ? '+' : ''}${t.amount.toLocaleString()}
                    <i class="icon-btn" onclick="app.delTxn('${t.id}')">✕</i>
                </span>
            </div>
        `).join('');

        this.renderMonthChips();
        this.updateChart(filtered);
        this.calcDaily(todayBal);
    },

    calcDaily(bal) {
        const today = new Date();
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const daysLeft = Math.max(1, lastDay - today.getDate());
        document.getElementById('dailyAvg').innerText = `${Math.round(bal / daysLeft).toLocaleString()} ${this.curr}`;
    },

    async saveTxn(isInc) {
        const pre = isInc ? 'inc' : 'exp';
        const amt = parseFloat(document.getElementById(pre+'Amt').value);
        const desc = document.getElementById(pre+'Desc').value;
        const date = document.getElementById(pre+'Date').value;
        if (!desc || isNaN(amt)) return;

        await db.from('transactions').insert([{
            user_id: this.user.id,
            description: desc,
            amount: isInc ? amt : -amt,
            category: isInc ? 'Příjem' : document.getElementById('expCat').value,
            date: date
        }]);
        this.loadTxns();
    },

    async delTxn(id) {
        if (confirm('Smazat?')) {
            await db.from('transactions').delete().eq('id', id);
            this.loadTxns();
        }
    },

    renderMonthChips() {
        const months = ['all', ...new Set(this.txns.map(t => t.date.slice(0,7)).sort().reverse())];
        document.getElementById('monthChips').innerHTML = months.map(m => `
            <span class="chip ${this.curMonth===m?'selected':''}" onclick="app.setMonth('${m}')">
                ${m==='all' ? 'Vše' : m}
            </span>
        `).join('');
    },
    setMonth(m) { this.curMonth = m; this.updateUI(); },

    renderCats() {
        const cats = this.user.custom_categories || this.defCats;
        document.getElementById('expCat').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
        document.getElementById('catEditor').innerHTML = cats.map((c, i) => `
            <div style="display:flex; gap:5px; margin-bottom:5px">
                <input type="text" value="${c}" onchange="app.editCat(${i}, this.value)">
                <button onclick="app.delCat(${i})" style="width:auto; background:var(--red); padding:5px 10px;">✕</button>
            </div>
        `).join('');
    },
    async editCat(i, v) { this.user.custom_categories[i] = v; await this.savePref(); },
    async delCat(i) { this.user.custom_categories.splice(i,1); await this.savePref(); this.renderCats(); },
    async addCat() { this.user.custom_categories.push("Nová"); await this.savePref(); this.renderCats(); },
    async updateCurr(v) { this.curr = v; await this.savePref(); this.updateUI(); },
    async savePref() { await db.from('app_users').update({ custom_categories: this.user.custom_categories, currency: this.curr }).eq('id', this.user.id); },

    updateChart(list) {
        const ctx = document.getElementById('myChart');
        const costs = list.filter(t => t.amount < 0);
        const data = {};
        costs.forEach(t => data[t.category] = (data[t.category] || 0) + Math.abs(t.amount));
        
        if (chart) chart.destroy();
        chart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(data),
                datasets: [{ data: Object.values(data), backgroundColor: ['#0081ff', '#10b981', '#a855f7', '#ef4444', '#f59e0b'] }]
            },
            options: { plugins: { legend: { display: false } } }
        });
    },

    async showAdmin() {
        this.showModal('adminOverlay');
        const { data: users } = await db.from('app_users').select('id, role');
        document.getElementById('adminUserList').innerHTML = users.map(u => `
            <div class="txn-item">
                <span>ID: ${u.id.slice(0,8)}... (${u.role})</span>
                <button style="width:auto; padding:5px 10px">Akce</button>
            </div>
        `).join('');
    }
};

window.app = app;
app.start();
