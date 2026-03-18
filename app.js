import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { config } from './config.js';
import { i18n } from './translations.js';

const db = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
let chart = null;

const app = {
    user: null, txns: [], curMonth: 'all', isAdmin: false,
    curr: 'Kč', lang: 'cs', theme: 'dark',
    defCats: ["Jídlo 🍕", "Běžné 🏠", "Blbosti 🛍️", "Spoření 💰"],

    async start() {
        this.setupEventListeners();
        const { data: { session } } = await db.auth.getSession();
        if (session) await this.handleAuth(session.user);
        else document.getElementById('authSection').classList.remove('hidden');
    },

    setupEventListeners() {
        const click = (id, fn) => { const el = document.getElementById(id); if(el) el.onclick = fn; };
        click('loginBtn', () => this.login());
        click('logoutBtn', () => this.logout());
        click('openSettings', () => this.showModal('settingsOverlay'));
        click('closeSettings', () => this.hideModal('settingsOverlay'));
        click('openAdmin', () => this.showModal('adminOverlay'));
        click('closeAdmin', () => this.hideModal('adminOverlay'));
        click('saveExpBtn', () => this.saveTxn(false));
        click('saveIncBtn', () => this.saveTxn(true));
        click('addCatBtn', () => this.addCat());
    },

    async handleAuth(authUser) {
        this.user = authUser;
        const { data: profile } = await db.from('app_users').select('*').eq('id', authUser.id).maybeSingle();
        if (profile) {
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
                <span><b>${t.description}</b><br><small>${t.date}</small></span>
                <span style="color:${t.amount>0?'var(--accent-green)':'var(--accent-red)'}">${t.amount}</span>
            </div>`).join('');
        this.updateChart(filtered);
    },

    async saveTxn(isInc) {
        const prefix = isInc ? 'inc' : 'exp';
        const amt = parseFloat(document.getElementById(prefix+'Amt').value);
        const desc = document.getElementById(prefix+'Desc').value;
        if (!desc || isNaN(amt)) return;
        await db.from('transactions').insert([{ 
            user_id: this.user.id, amount: isInc?amt:-amt, description: desc, 
            category: isInc?'Příjem':document.getElementById('expCat').value, 
            date: document.getElementById(prefix+'Date').value 
        }]);
        this.loadTxns();
    },

    renderCats() {
        document.getElementById('expCat').innerHTML = this.user.custom_categories.map(c => `<option>${c}</option>`).join('');
    },

    updateChart(list) {
        const ctx = document.getElementById('myChart'); if(!ctx) return;
        const data = {}; list.filter(t => t.amount < 0).forEach(t => data[t.category] = (data[t.category]||0) + Math.abs(t.amount));
        if(chart) chart.destroy();
        chart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: ['#0081ff', '#10b981', '#f59e0b', '#ef4444'] }] }, options: { plugins: { legend: { display:false } } } });
    }
};

window.app = app;
app.start();
