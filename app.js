const cfg = window.LIYAQA_CONFIG;
const supabaseClient = window.supabase?.createClient?.(cfg.supabaseUrl, cfg.supabaseAnonKey);

const state = {
  session: null,
  profile: null,
  dailyMetrics: [],
  workouts: [],
  meals: [],
  charts: {}
};

const els = {
  authView: qs('#authView'),
  appViews: qs('#appViews'),
  authMsg: qs('#authMsg'),
  logoutBtn: qs('#logoutBtn'),
  planBadge: qs('#planBadge'),
  planStatusText: qs('#planStatusText'),
  welcomeText: qs('#welcomeText'),
  viewTitle: qs('#viewTitle'),
  recommendations: qs('#recommendations'),
  workoutsList: qs('#workoutsList'),
  mealList: qs('#mealList'),
  adminWorkoutsList: qs('#adminWorkoutsList'),
  adminUsersList: qs('#adminUsersList'),
  subscriptionMsg: qs('#subscriptionMsg')
};

init();

async function init() {
  if (!supabaseClient || !cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes('YOUR_') || cfg.supabaseAnonKey.includes('YOUR_')) {
    els.authMsg.textContent = 'ضع مفاتيح Supabase داخل config.js أولاً ثم أعد تحميل الصفحة.';
    bindUi();
    return;
  }

  bindUi();
  const { data: { session } } = await supabaseClient.auth.getSession();
  state.session = session;
  await applyAuthState();
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    await applyAuthState();
  });
}

function bindUi() {
  qsa('.nav-link').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  qsa('.tab').forEach(btn => btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab)));
  qs('#themeToggle').addEventListener('click', toggleTheme);
  qs('#loginForm').addEventListener('submit', onLogin);
  qs('#registerForm').addEventListener('submit', onRegister);
  qs('#dailyMetricsForm').addEventListener('submit', saveDailyMetrics);
  qs('#mealForm').addEventListener('submit', saveMeal);
  qs('#workoutAdminForm').addEventListener('submit', saveWorkout);
  qs('#logoutBtn').addEventListener('click', async () => { await supabaseClient.auth.signOut(); });
  qs('#refreshWorkoutsBtn').addEventListener('click', loadWorkouts);
  qsa('.subscription-btn').forEach(btn => btn.addEventListener('click', onSubscribe));
  const savedTheme = localStorage.getItem('liyaqa_theme') || 'light';
  document.body.classList.toggle('dark', savedTheme === 'dark');
}

async function applyAuthState() {
  const loggedIn = !!state.session?.user;
  els.authView.classList.toggle('hidden', loggedIn);
  els.appViews.classList.toggle('hidden', !loggedIn);
  els.logoutBtn.classList.toggle('hidden', !loggedIn);

  if (!loggedIn) {
    switchView('dashboard');
    return;
  }

  await loadProfile();
  await Promise.all([loadDailyMetrics(), loadMeals(), loadWorkouts()]);
  await maybeLoadAdminData();
  renderAll();
}

async function onLogin(e) {
  e.preventDefault();
  const email = qs('#loginEmail').value.trim();
  const password = qs('#loginPassword').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  els.authMsg.textContent = error ? error.message : 'تم تسجيل الدخول.';
}

async function onRegister(e) {
  e.preventDefault();
  const payload = {
    email: qs('#registerEmail').value.trim(),
    password: qs('#registerPassword').value,
    options: {
      data: {
        full_name: qs('#registerName').value.trim(),
        goal: qs('#registerGoal').value
      }
    }
  };
  const { error } = await supabaseClient.auth.signUp(payload);
  els.authMsg.textContent = error ? error.message : 'تم إنشاء الحساب. افحص البريد لتأكيده إذا كان التفعيل مطلوبًا.';
}

async function loadProfile() {
  const user = state.session.user;
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (!data && !error) {
    const starter = {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || 'مستخدم جديد',
      goal: user.user_metadata?.goal || 'fitness',
      role: 'member',
      subscription_plan: 'free',
      subscription_status: 'inactive'
    };
    await supabaseClient.from('profiles').upsert(starter);
    state.profile = starter;
  } else {
    state.profile = data;
  }
}

async function loadDailyMetrics() {
  const { data } = await supabaseClient
    .from('daily_metrics')
    .select('*')
    .order('entry_date', { ascending: true })
    .limit(30);
  state.dailyMetrics = data || [];
}

async function loadMeals() {
  const { data } = await supabaseClient
    .from('meal_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  state.meals = data || [];
}

async function loadWorkouts() {
  const { data, error } = await supabaseClient
    .from('workout_programs')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Workout load error:', error);
    state.workouts = [];
    els.workoutsList.innerHTML = `<div class="muted">تعذر تحميل التمارين الآن.</div>`;
    return;
  }

  state.workouts = data || [];
  renderWorkouts();
}

async function maybeLoadAdminData() {
  const isAdmin = state.profile?.role === 'admin';
  qs('.admin-only').classList.toggle('hidden', !isAdmin);
  if (!isAdmin) return;
  const { data: users } = await supabaseClient
    .from('profiles')
    .select('id, full_name, email, role, subscription_plan, subscription_status')
    .order('created_at', { ascending: false });
  renderUsers(users || []);
}

async function saveDailyMetrics(e) {
  e.preventDefault();
  const record = {
    user_id: state.session.user.id,
    entry_date: new Date().toISOString().slice(0, 10),
    steps: num('#stepsInput'),
    calories: num('#caloriesInput'),
    water_cups: num('#waterInput'),
    sleep_hours: num('#sleepInput'),
    weight_kg: num('#weightInput'),
    heart_rate: num('#heartInput')
  };
  const { error } = await supabaseClient.from('daily_metrics').upsert(record, { onConflict: 'user_id,entry_date' });
  if (!error) { await loadDailyMetrics(); renderAll(); }
}

async function saveMeal(e) {
  e.preventDefault();
  const record = {
    user_id: state.session.user.id,
    meal_name: qs('#mealName').value.trim(),
    protein_g: num('#proteinInput'),
    carbs_g: num('#carbsInput'),
    fat_g: num('#fatInput')
  };
  const { error } = await supabaseClient.from('meal_logs').insert(record);
  if (!error) {
    e.target.reset();
    await loadMeals();
    renderMeals();
  }
}

async function saveWorkout(e) {
  e.preventDefault();
  const record = {
    name: qs('#adminWorkoutName').value.trim(),
    duration_minutes: num('#adminWorkoutDuration'),
    intensity: qs('#adminWorkoutIntensity').value,
    estimated_calories: num('#adminWorkoutCalories'),
    is_active: true,
    created_by: state.session.user.id
  };
  const { error } = await supabaseClient.from('workout_programs').insert(record);
  if (!error) {
    e.target.reset();
    await loadWorkouts();
    renderAdminWorkouts();
  }
}

async function onSubscribe(e) {
  const plan = e.currentTarget.dataset.plan;
  const link = cfg.stripeLinks[plan];
  if (!link || link.includes('test_')) {
    els.subscriptionMsg.textContent = 'أضف رابط Stripe الحقيقي لهذا الاشتراك داخل config.js.';
    return;
  }

  await supabaseClient.from('subscription_events').insert({
    user_id: state.session.user.id,
    event_type: 'checkout_started',
    payload: { plan, source: 'client_redirect' }
  });

  window.location.href = link + `?prefilled_email=${encodeURIComponent(state.session.user.email)}`;
}

function renderAll() {
  renderDashboard();
  renderMeals();
  renderWorkouts();
  renderAdminWorkouts();
  updatePlanUi();
}

function renderDashboard() {
  const latest = state.dailyMetrics.at(-1) || {};
  setText('#stepsValue', latest.steps || 0);
  setText('#caloriesValue', latest.calories || 0);
  setText('#waterValue', latest.water_cups || 0);
  setText('#sleepMetric', `${latest.sleep_hours || 0} س`);
  setText('#heartMetric', latest.heart_rate || 0);
  setText('#weightMetric', `${latest.weight_kg || 0} كجم`);
  setText('#goalMetric', goalLabel(state.profile?.goal));
  els.welcomeText.textContent = `مرحبًا ${state.profile?.full_name || ''} — استمر على وتيرتك الصحية.`;

  renderRing('stepsRing', latest.steps || 0, 10000, ['#10b981', '#dbeafe']);
  renderRing('caloriesRing', latest.calories || 0, 900, ['#2563eb', '#dbeafe']);
  renderRing('waterRing', latest.water_cups || 0, 8, ['#06b6d4', '#dbeafe']);
  renderRecommendations(latest);
  renderProgressCharts();
}

function renderRecommendations(latest) {
  const cards = [];
  if ((latest.water_cups || 0) < 6) cards.push(['اشرب ماء أكثر', 'أضف كوبين ماء خلال الساعتين القادمتين.']);
  if ((latest.steps || 0) < 7000) cards.push(['تحرك قليلًا', 'امشِ 15 دقيقة للوصول إلى هدف اليوم.']);
  if ((latest.sleep_hours || 0) < 7) cards.push(['حسّن النوم', 'حاول النوم مبكرًا الليلة لتحسين التعافي.']);
  if (!cards.length) cards.push(['أداء ممتاز', 'أكملت معظم أهدافك اليومية. استمر.']);
  els.recommendations.innerHTML = cards.map(([t, d]) => `<div class="recommendation-card"><strong>${t}</strong><span class="muted">${d}</span></div>`).join('');
}

function renderWorkouts() {
  els.workoutsList.innerHTML = state.workouts.map(w => `
    <article class="workout-card">
      <h4>${w.name}</h4>
      <div class="workout-meta">${w.duration_minutes} دقيقة • ${labelIntensity(w.intensity)} • ${w.estimated_calories} سعرة</div>
      <div class="badge info" style="margin-top:12px;width:max-content">ابدأ الآن</div>
    </article>
  `).join('') || `<div class="muted">لا توجد برامج بعد.</div>`;
}

function renderMeals() {
  const totals = state.meals.reduce((acc, m) => {
    acc.protein += m.protein_g || 0;
    acc.carbs += m.carbs_g || 0;
    acc.fat += m.fat_g || 0;
    return acc;
  }, { protein: 0, carbs: 0, fat: 0 });

  if (state.charts.macros) state.charts.macros.destroy();
  state.charts.macros = new Chart(qs('#macrosChart'), {
    type: 'doughnut',
    data: {
      labels: ['Protein', 'Carbs', 'Fat'],
      datasets: [{ data: [totals.protein, totals.carbs, totals.fat], backgroundColor: ['#10b981', '#2563eb', '#f59e0b'] }]
    },
    options: chartBase('المغذيات')
  });

  els.mealList.innerHTML = state.meals.map(m => `
    <article class="meal-card">
      <h4>${m.meal_name}</h4>
      <div class="workout-meta">P ${m.protein_g}g • C ${m.carbs_g}g • F ${m.fat_g}g</div>
    </article>
  `).join('') || `<div class="muted">لا توجد وجبات مسجلة.</div>`;
}

function renderProgressCharts() {
  const labels = state.dailyMetrics.map(r => r.entry_date?.slice(5));
  const steps = state.dailyMetrics.map(r => r.steps || 0);
  const calories = state.dailyMetrics.map(r => r.calories || 0);
  const sleep = state.dailyMetrics.map(r => r.sleep_hours || 0);
  const weight = state.dailyMetrics.map(r => r.weight_kg || 0);

  if (state.charts.line) state.charts.line.destroy();
  state.charts.line = new Chart(qs('#progressLineChart'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'الخطوات', data: steps, borderColor: '#10b981', tension: .35 },
      { label: 'السعرات', data: calories, borderColor: '#2563eb', tension: .35 }
    ]}, options: chartBase('التقدم')
  });

  if (state.charts.bar) state.charts.bar.destroy();
  state.charts.bar = new Chart(qs('#progressBarChart'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'النوم', data: sleep, backgroundColor: '#06b6d4' },
      { label: 'الوزن', data: weight, backgroundColor: '#f59e0b' }
    ]}, options: chartBase('التقدم')
  });
}

function renderAdminWorkouts() {
  if (state.profile?.role !== 'admin') return;
  els.adminWorkoutsList.innerHTML = state.workouts.map(w => `<div class="admin-item"><h4>${w.name}</h4><div class="muted">${w.duration_minutes} دقيقة • ${labelIntensity(w.intensity)}</div></div>`).join('');
}

function renderUsers(users) {
  if (state.profile?.role !== 'admin') return;
  els.adminUsersList.innerHTML = users.map(u => `<div class="user-item"><h4>${u.full_name || 'بدون اسم'}</h4><div class="muted">${u.email}<br>${u.role} • ${u.subscription_plan} • ${u.subscription_status}</div></div>`).join('');
}

function updatePlanUi() {
  els.planBadge.textContent = state.profile?.subscription_plan || 'free';
  els.planStatusText.textContent = state.profile?.subscription_status === 'active'
    ? 'اشتراكك فعّال ويمكنك الاستفادة من المزايا المدفوعة.'
    : 'اشتراكك غير مفعّل بعد. يمكنك الترقية في أي وقت.';
}

function switchView(view) {
  qsa('.nav-link').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  qsa('.app-view').forEach(v => {
    const isTarget = v.id === view;
    v.classList.toggle('hidden', !isTarget);
    v.classList.toggle('active', isTarget);
  });
  const label = { dashboard: 'لوحة اليوم', workouts: 'التمارين', nutrition: 'التغذية', progress: 'الإحصائيات', subscription: 'الاشتراك', admin: 'لوحة الإدارة' }[view] || 'لياقة';
  els.viewTitle.textContent = label;
}

function switchAuthTab(tab) {
  qsa('.tab').forEach(x => x.classList.toggle('active', x.dataset.authTab === tab));
  qs('#loginForm').classList.toggle('hidden', tab !== 'login');
  qs('#registerForm').classList.toggle('hidden', tab !== 'register');
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('liyaqa_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
}

function renderRing(canvasId, value, total, colors) {
  const key = `ring_${canvasId}`;
  if (state.charts[key]) state.charts[key].destroy();
  state.charts[key] = new Chart(qs(`#${canvasId}`), {
    type: 'doughnut',
    data: { datasets: [{ data: [Math.min(value, total), Math.max(total - value, 0)], backgroundColor: colors, borderWidth: 0 }] },
    options: { cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
  });
}

function chartBase() {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: getComputedStyle(document.body).getPropertyValue('--text') } } },
    scales: {
      x: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--muted') }, grid: { color: 'rgba(148,163,184,.16)' } },
      y: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--muted') }, grid: { color: 'rgba(148,163,184,.16)' } }
    }
  };
}

function goalLabel(v) {
  return ({ weight_loss: 'خفض الوزن', fitness: 'لياقة عامة', muscle: 'بناء عضل', wellness: 'عافية' }[v] || '—');
}
function labelIntensity(v) { return ({ low: 'منخفضة', medium: 'متوسطة', high: 'عالية' }[v] || v); }
function qs(s) { return document.querySelector(s); }
function qsa(s) { return [...document.querySelectorAll(s)]; }
function setText(sel, val) { qs(sel).textContent = val; }
function num(sel) { return Number(qs(sel).value || 0); }
