const user = requireRole('propietario');
document.getElementById('logoBox').innerHTML = logoSVG() + '<span class="vc-logo-text">Vet<span>core</span></span>';

if (user) {
  document.getElementById('userName').textContent = user.nombre_clinica || user.nombre || 'Mi clínica';
  document.getElementById('userPlan').textContent = (user.plan_nombre || 'Sin plan');
  document.getElementById('avatarLetter').textContent = iniciales(user.nombre_clinica || user.nombre || 'V');
  document.getElementById('clinicaTag').textContent = user.plan_nombre ? user.plan_nombre : 'Mi clínica';
}

// ══════════════════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════════════════
const titles = {
  inicio: 'Inicio', clientes: 'Clientes', pacientes: 'Pacientes', agenda: 'Agenda',
  historia: 'Historia clínica', ventas: 'Ventas', inventario: 'Inventario',
  atencion: 'Atención', personal: 'Personal', caja: 'Finanzas / Caja', reportes: 'Reportes', config: 'Configuración'
};
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => ir(btn.dataset.sec)));

function ir(sec) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('sec-' + sec).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-sec="${sec}"]`).classList.add('active');
  document.getElementById('pageTitle').textContent = titles[sec];
  document.getElementById('sidebar').classList.remove('open');

  if (sec === 'inicio') cargarResumen();
  if (sec === 'clientes') cargarClientes();
  if (sec === 'pacientes') cargarPacientes();
  if (sec === 'agenda') cargarCitas();
  if (sec === 'historia') cargarSelectPacientesHistoria();
  if (sec === 'ventas') cargarVentas();
  if (sec === 'inventario') cargarProductos();
  if (sec === 'atencion') cargarAtenciones();
  if (sec === 'personal') cargarPersonal();
  if (sec === 'caja') cargarCaja();
  if (sec === 'reportes') cargarReportes();
  if (sec === 'config') cargarConfiguracion();
}

// ══════════════════════════════════════════════════════════════
// VETERINARIOS (para asignar citas y atenciones)
// ══════════════════════════════════════════════════════════════
let _veterinarios = [];
async function asegurarVeterinariosCargados() {
  const d = await api('/api/veterinarios', { headers: authHeaders() });
  _veterinarios = d.ok ? d.veterinarios : [];
}
function poblarSelectVeterinarios(selectId, valorSel) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">— Sin asignar —</option>' +
    _veterinarios.map(v => `<option value="${v.id}" ${String(v.id) === String(valorSel) ? 'selected' : ''}>${v.nombre}</option>`).join('');
}

// ══════════════════════════════════════════════════════════════
// CLIENTES
// ══════════════════════════════════════════════════════════════
let _clientes = [];
async function cargarClientes() {
  const d = await api('/api/clientes', { headers: authHeaders() });
  _clientes = d.ok ? d.clientes : [];
  renderClientes();
}
function renderClientes() {
  document.getElementById('tbClientes').innerHTML = _clientes.length
    ? _clientes.map(c => `<tr>
        <td><strong>${c.nombre}</strong></td>
        <td>${c.telefono || '—'}</td>
        <td>${c.email || '—'}</td>
        <td>${c.documento || '—'}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" onclick="abrirEditarCliente(${c.id})">Editar</button>
            <button class="btn btn-danger btn-sm" onclick="eliminarCliente(${c.id})">Eliminar</button>
          </div>
        </td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="5">Aún no tienes clientes registrados</td></tr>';
}
function abrirCrearCliente() {
  document.getElementById('mClienteTitulo').textContent = 'Nuevo cliente';
  document.getElementById('cl_id').value = '';
  ['cl_nombre', 'cl_telefono', 'cl_email', 'cl_documento', 'cl_direccion'].forEach(id => document.getElementById(id).value = '');
  abrirModal('mCliente');
}
function abrirEditarCliente(id) {
  const c = _clientes.find(x => x.id === id); if (!c) return;
  document.getElementById('mClienteTitulo').textContent = 'Editar cliente';
  document.getElementById('cl_id').value = c.id;
  document.getElementById('cl_nombre').value = c.nombre || '';
  document.getElementById('cl_telefono').value = c.telefono || '';
  document.getElementById('cl_email').value = c.email || '';
  document.getElementById('cl_documento').value = c.documento || '';
  document.getElementById('cl_direccion').value = c.direccion || '';
  abrirModal('mCliente');
}
async function guardarCliente() {
  const id = document.getElementById('cl_id').value;
  const body = {
    nombre: document.getElementById('cl_nombre').value.trim(),
    telefono: document.getElementById('cl_telefono').value.trim(),
    email: document.getElementById('cl_email').value.trim(),
    documento: document.getElementById('cl_documento').value.trim(),
    direccion: document.getElementById('cl_direccion').value.trim(),
  };
  if (!body.nombre) { toast('El nombre es obligatorio', 'rojo'); return; }
  const d = await api(id ? `/api/clientes/${id}` : '/api/clientes', {
    method: id ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(body)
  });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Cliente guardado', 'verde');
  cerrarModal('mCliente');
  cargarClientes();
}
async function eliminarCliente(id) {
  if (!confirm('¿Eliminar este cliente? También se eliminarán sus mascotas.')) return;
  const d = await api(`/api/clientes/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Cliente eliminado', 'verde');
  cargarClientes();
}
async function asegurarClientesCargados() {
  if (!_clientes.length) {
    const d = await api('/api/clientes', { headers: authHeaders() });
    _clientes = d.ok ? d.clientes : [];
  }
}
function poblarSelectClientes(selectId, valorSel) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">— Selecciona un cliente —</option>' +
    _clientes.map(c => `<option value="${c.id}" ${String(c.id) === String(valorSel) ? 'selected' : ''}>${c.nombre}</option>`).join('');
}

// ══════════════════════════════════════════════════════════════
// PACIENTES
// ══════════════════════════════════════════════════════════════
let _pacientes = [];
async function cargarPacientes() {
  const d = await api('/api/pacientes', { headers: authHeaders() });
  _pacientes = d.ok ? d.pacientes : [];
  renderPacientes();
}
function renderPacientes() {
  document.getElementById('tbPacientes').innerHTML = _pacientes.length
    ? _pacientes.map(p => `<tr>
        <td>
          ${p.foto_url ? `<img src="${p.foto_url}" class="avatar-mini">` : `<span class="avatar-mini-placeholder">🐾</span>`}
          <a href="#" onclick="abrirFichaPaciente(${p.id});return false;" style="color:var(--primary-dark);font-weight:700;text-decoration:none;">${p.nombre}</a>
        </td>
        <td>${p.cliente_nombre}</td>
        <td>${p.especie || '—'} ${p.raza ? '· ' + p.raza : ''}</td>
        <td>${p.peso ? p.peso + ' kg' : '—'}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" onclick="abrirEditarPaciente(${p.id})">Editar</button>
            <button class="btn btn-danger btn-sm" onclick="eliminarPaciente(${p.id})">Eliminar</button>
          </div>
        </td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="5">Aún no tienes pacientes registrados</td></tr>';
}
async function asegurarPacientesCargados() {
  if (!_pacientes.length) {
    const d = await api('/api/pacientes', { headers: authHeaders() });
    _pacientes = d.ok ? d.pacientes : [];
  }
}
async function abrirCrearPaciente() {
  await asegurarClientesCargados();
  poblarSelectClientes('pa_cliente_id');
  document.getElementById('mPacienteTitulo').textContent = 'Nueva mascota';
  document.getElementById('pa_id').value = '';
  ['pa_nombre', 'pa_especie', 'pa_raza', 'pa_fnac', 'pa_peso', 'pa_color', 'pa_microchip', 'pa_alergias', 'pa_observaciones'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pa_sexo').value = '';
  document.getElementById('pa_foto_preview_box').innerHTML = '<div class="pac-foto-placeholder">🐾</div>';
  _pacienteFotoFile = null;
  abrirModal('mPaciente');
}
async function abrirEditarPaciente(id) {
  const p = _pacientes.find(x => x.id === id); if (!p) return;
  await asegurarClientesCargados();
  poblarSelectClientes('pa_cliente_id', p.cliente_id);
  document.getElementById('mPacienteTitulo').textContent = 'Editar mascota';
  document.getElementById('pa_id').value = p.id;
  document.getElementById('pa_nombre').value = p.nombre || '';
  document.getElementById('pa_especie').value = p.especie || '';
  document.getElementById('pa_raza').value = p.raza || '';
  document.getElementById('pa_sexo').value = p.sexo || '';
  document.getElementById('pa_fnac').value = p.fecha_nacimiento ? String(p.fecha_nacimiento).slice(0, 10) : '';
  document.getElementById('pa_peso').value = p.peso || '';
  document.getElementById('pa_color').value = p.color || '';
  document.getElementById('pa_microchip').value = p.microchip || '';
  document.getElementById('pa_alergias').value = p.alergias || '';
  document.getElementById('pa_observaciones').value = p.observaciones || '';
  document.getElementById('pa_foto_preview_box').innerHTML = p.foto_url
    ? `<img src="${p.foto_url}" class="pac-foto-preview">`
    : '<div class="pac-foto-placeholder">🐾</div>';
  _pacienteFotoFile = null;
  abrirModal('mPaciente');
}
async function guardarPaciente() {
  const id = document.getElementById('pa_id').value;
  const cliente_id = document.getElementById('pa_cliente_id').value;
  const body = {
    cliente_id,
    nombre: document.getElementById('pa_nombre').value.trim(),
    especie: document.getElementById('pa_especie').value.trim(),
    raza: document.getElementById('pa_raza').value.trim(),
    sexo: document.getElementById('pa_sexo').value,
    fecha_nacimiento: document.getElementById('pa_fnac').value || null,
    peso: document.getElementById('pa_peso').value || null,
    color: document.getElementById('pa_color').value.trim(),
    microchip: document.getElementById('pa_microchip').value.trim(),
    alergias: document.getElementById('pa_alergias').value.trim(),
    observaciones: document.getElementById('pa_observaciones').value.trim(),
  };
  if (!id && !cliente_id) { toast('Selecciona el propietario', 'rojo'); return; }
  if (!body.nombre) { toast('El nombre de la mascota es obligatorio', 'rojo'); return; }
  const d = await api(id ? `/api/pacientes/${id}` : '/api/pacientes', {
    method: id ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(body)
  });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  const fotoOk = await subirFotoPacienteSiHay(id || d.id);
  cerrarModal('mPaciente');
  cargarPacientes();
  if (fotoOk === false) return;
  toast('Mascota guardada', 'verde');
}
async function eliminarPaciente(id) {
  if (!confirm('¿Eliminar esta mascota? Se eliminará también su historia clínica.')) return;
  const d = await api(`/api/pacientes/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Mascota eliminada', 'verde');
  cargarPacientes();
}

// ══════════════════════════════════════════════════════════════
// AGENDA
// ══════════════════════════════════════════════════════════════
let _citas = [];
let _agMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let _agDiaSel = '';
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const ESTADOS_CITA = ['pendiente', 'confirmada', 'en_espera', 'atendiendo', 'atendida', 'no_asistio', 'cancelada'];
const estadoBadge = { pendiente: 'b-grey', confirmada: 'b-primary', en_espera: 'b-accent', atendiendo: 'b-accent', atendida: 'b-primary', cancelada: 'b-danger', no_asistio: 'b-danger' };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fechaCita = (c) => {
  const f = String(c.fecha || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  const d = new Date(f);
  return isNaN(d) ? f.slice(0, 10) : ymd(d);
};

async function cargarCitas() {
  const [d] = await Promise.all([
    api('/api/citas', { headers: authHeaders() }),
    asegurarVeterinariosCargados(),
    asegurarClientesCargados(),
  ]);
  _citas = d.ok ? d.citas : [];
  renderCalendario();
  renderCitas();
}

function agVista(v) {
  document.getElementById('ag_cal_wrap').style.display = v === 'cal' ? '' : 'none';
  document.getElementById('ag_lista_wrap').style.display = v === 'lista' ? '' : 'none';
  document.getElementById('ag_btn_cal').className = 'btn btn-sm ' + (v === 'cal' ? 'btn-primary' : 'btn-ghost');
  document.getElementById('ag_btn_lista').className = 'btn btn-sm ' + (v === 'lista' ? 'btn-primary' : 'btn-ghost');
}
function agMes(delta) {
  _agMes = new Date(_agMes.getFullYear(), _agMes.getMonth() + delta, 1);
  renderCalendario();
}
function agHoy() {
  const h = new Date();
  _agMes = new Date(h.getFullYear(), h.getMonth(), 1);
  renderCalendario();
}

function renderCalendario() {
  const y = _agMes.getFullYear(), m = _agMes.getMonth();
  document.getElementById('cal_titulo').textContent = `${MESES[m]} ${y}`;
  const grid = document.getElementById('cal_grid');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:14px;';

  const porDia = {};
  _citas.forEach(c => { const f = fechaCita(c); (porDia[f] = porDia[f] || []).push(c); });

  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // semana empieza en lunes
  const diasMes = new Date(y, m + 1, 0).getDate();
  const hoy = ymd(new Date());

  let html = DIAS.map(d => `<div style="text-align:center;font-size:12px;font-weight:700;color:var(--ink-soft);padding:4px 0;">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) html += '<div></div>';
  for (let d = 1; d <= diasMes; d++) {
    const f = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = (porDia[f] || []).length;
    const esHoy = f === hoy;
    html += `<div onclick="abrirDiaAgenda('${f}')" style="cursor:pointer;min-height:70px;padding:6px 8px;border:1px solid ${esHoy ? 'var(--primary,#0f6b4f)' : 'var(--border)'};border-radius:10px;background:${n ? 'rgba(15,107,79,.08)' : '#fff'};">
      <div style="font-size:13px;font-weight:${esHoy ? 800 : 600};">${d}</div>
      ${n ? `<span class="badge b-primary" style="margin-top:6px;display:inline-block;">${n} cita${n > 1 ? 's' : ''}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;
}

function abrirDiaAgenda(f) {
  _agDiaSel = f;
  const citas = _citas.filter(c => fechaCita(c) === f).sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
  document.getElementById('mDiaTitulo').textContent = 'Citas del ' + fmtFecha(f);
  document.getElementById('mDiaSub').textContent = citas.length ? `${citas.length} cita(s)` : '';
  document.getElementById('mDiaCont').innerHTML = citas.length
    ? citas.map(c => `
      <div class="inicio-list-item">
        <span class="inicio-hora">${c.hora ? c.hora.slice(0, 5) : '—'}</span>
        <span style="flex:1;">${c.paciente_nombre || '—'} (${c.cliente_nombre || '—'})${c.veterinario_nombre ? ' · ' + c.veterinario_nombre : ''} — ${c.motivo || 'Consulta'}</span>
        <span class="badge ${estadoBadge[c.estado] || 'b-grey'}">${(c.estado || '').replace('_', ' ')}</span>
        <button class="btn btn-ghost btn-sm" onclick="whatsappCita(${c.id})" style="color:#25D366;font-weight:700;">WhatsApp</button>
      </div>`).join('')
    : '<p style="color:var(--ink-soft);font-size:13px;">No hay citas este día.</p>';
  abrirModal('mDiaAgenda');
}
function nuevaCitaDia() {
  cerrarModal('mDiaAgenda');
  abrirCrearCita(_agDiaSel);
}

function renderCitas() {
  const lista = [..._citas].sort((a, b) => (fechaCita(a) + String(a.hora)).localeCompare(fechaCita(b) + String(b.hora)));
  document.getElementById('tbCitas').innerHTML = lista.length
    ? lista.map(c => `<tr>
        <td>${fmtFecha(c.fecha)}</td>
        <td>${c.hora ? c.hora.slice(0, 5) : '—'}</td>
        <td>${c.cliente_nombre || '—'}</td>
        <td>${c.paciente_nombre || '—'}</td>
        <td>${c.veterinario_nombre || '—'}</td>
        <td>${c.motivo || '—'}</td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;">
            <select onchange="cambiarEstadoCita(${c.id}, this.value)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);font-size:12px;">
              ${ESTADOS_CITA.map(e => `<option value="${e}" ${e === c.estado ? 'selected' : ''}>${e.replace('_', ' ')}</option>`).join('')}
            </select>
            <button class="btn btn-ghost btn-sm" title="Enviar recordatorio por WhatsApp" onclick="whatsappCita(${c.id})" style="color:#25D366;font-weight:700;">WhatsApp</button>
          </div>
        </td>
        <td><button class="btn btn-danger btn-sm" onclick="eliminarCita(${c.id})">Eliminar</button></td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="8">No hay citas agendadas</td></tr>';
}

function telefonoWhatsApp(raw) {
  let n = String(raw || '').replace(/\D/g, '');
  if (!n) return '';
  if (n.startsWith('593')) return n;
  if (n.startsWith('0')) n = n.slice(1);
  return '593' + n; // Ecuador
}

function whatsappCita(id) {
  const c = _citas.find(x => x.id === id); if (!c) return;
  const cli = _clientes.find(x => String(x.id) === String(c.cliente_id)) || _clientes.find(x => x.nombre === c.cliente_nombre);
  const tel = telefonoWhatsApp(c.cliente_telefono || cli?.telefono);
  if (!tel) { toast('Este cliente no tiene teléfono registrado', 'rojo'); return; }

  const clinica = (user && user.nombre_clinica) || 'la clínica veterinaria';
  const cliente = c.cliente_nombre || '';
  const mascota = c.paciente_nombre || 'su mascota';
  const fecha = fmtFecha(c.fecha);
  const hora = c.hora ? c.hora.slice(0, 5) : '';
  const cuando = hora ? `el ${fecha} a las ${hora}` : `el ${fecha}`;

  const mensajes = {
    pendiente:  `Hola ${cliente} 👋, le recordamos la cita de *${mascota}* ${cuando} en ${clinica}. ¿Nos confirma su asistencia? 🐾`,
    confirmada: `Hola ${cliente} 👋, su cita para *${mascota}* está confirmada para ${cuando} en ${clinica}. ¡Los esperamos! 🐾`,
    en_espera:  `Hola ${cliente}, *${mascota}* está en lista de espera en ${clinica}. En breve será atendido. 🐾`,
    atendiendo: `Hola ${cliente}, *${mascota}* está siendo atendido en este momento en ${clinica}. Le avisaremos cuando termine. 🐾`,
    atendida:   `Hola ${cliente} 👋, la atención de *${mascota}* del ${fecha} ya está completa ✅. Gracias por confiar en ${clinica}. Cualquier duda, escríbanos. 🐾`,
    cancelada:  `Hola ${cliente}, la cita de *${mascota}* (${cuando}) fue cancelada. Si desea reagendar, escríbanos y con gusto le ayudamos. 🐾`,
    no_asistio: `Hola ${cliente}, notamos que no pudo asistir a la cita de *${mascota}* (${cuando}). ¿Desea reagendarla? 🐾`,
  };

  const texto = mensajes[c.estado] || mensajes.pendiente;
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank');
}
async function poblarPacientesDeCliente(selectId, clienteId) {
  await Promise.all([asegurarClientesCargados(), asegurarPacientesCargados()]);
  const sel = document.getElementById(selectId);
  const lista = clienteId ? _pacientes.filter(p => String(p.cliente_id) === String(clienteId)) : [];
  sel.innerHTML = '<option value="">— Sin mascota —</option>' +
    lista.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
}
async function abrirCrearCita(fecha) {
  await Promise.all([asegurarClientesCargados(), asegurarVeterinariosCargados()]);
  poblarSelectClientes('ci_cliente_id');
  poblarSelectVeterinarios('ci_veterinario_id');
  document.getElementById('ci_paciente_id').innerHTML = '<option value="">— Selecciona un cliente primero —</option>';
  ['ci_hora', 'ci_motivo', 'ci_notas'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('ci_fecha').value = typeof fecha === 'string' ? fecha : '';
  abrirModal('mCita');
}
async function guardarCita() {
  const body = {
    cliente_id: document.getElementById('ci_cliente_id').value || null,
    paciente_id: document.getElementById('ci_paciente_id').value || null,
    veterinario_id: document.getElementById('ci_veterinario_id').value || null,
    fecha: document.getElementById('ci_fecha').value,
    hora: document.getElementById('ci_hora').value || null,
    motivo: document.getElementById('ci_motivo').value.trim(),
    notas: document.getElementById('ci_notas').value.trim(),
  };
  if (!body.fecha) { toast('La fecha es obligatoria', 'rojo'); return; }
  const d = await api('/api/citas', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Cita agendada', 'verde');
  cerrarModal('mCita');
  cargarCitas();
}
async function cambiarEstadoCita(id, estado) {
  const d = await api(`/api/citas/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ estado }) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Estado actualizado', 'verde');
  cargarCitas();
}
async function eliminarCita(id) {
  if (!confirm('¿Eliminar esta cita?')) return;
  const d = await api(`/api/citas/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Cita eliminada', 'verde');
  cargarCitas();
}

// ══════════════════════════════════════════════════════════════
// HISTORIA CLÍNICA
// ══════════════════════════════════════════════════════════════
let _pacienteHistoriaActivo = null;
async function cargarSelectPacientesHistoria() {
  await asegurarPacientesCargados();
  const sel = document.getElementById('hc_paciente_select');
  sel.innerHTML = '<option value="">— Elige una mascota —</option>' +
    _pacientes.map(p => `<option value="${p.id}">${p.nombre} — ${p.cliente_nombre}</option>`).join('');
}
async function cargarHistoriaPaciente() {
  const id = document.getElementById('hc_paciente_select').value;
  _pacienteHistoriaActivo = id || null;
  const wrap = document.getElementById('hc_wrap');
  if (!id) { wrap.innerHTML = '<p style="color:var(--ink-soft);font-size:13.5px;">Elige un paciente para ver o registrar su historia clínica.</p>'; return; }

  wrap.innerHTML = '<p style="color:var(--ink-soft);font-size:13.5px;">Cargando...</p>';
  const d = await api(`/api/historias/${id}`, { headers: authHeaders() });
  const historias = d.ok ? d.historias : [];
  const paciente = _pacientes.find(p => String(p.id) === String(id));

  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div><strong>${paciente?.nombre || ''}</strong> <span style="color:var(--ink-soft);font-size:13px;">— ${paciente?.especie || ''} ${paciente?.raza ? '· ' + paciente.raza : ''}</span></div>
      <button class="btn btn-primary btn-sm" onclick="abrirNuevaConsulta()">+ Nueva consulta</button>
    </div>
    <div id="hc_lista">
      ${historias.length ? historias.map(h => `
        <div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="font-size:13.5px;">${fmtFecha(h.fecha)}${h.motivo ? ' — ' + h.motivo : ''}</strong>
            <button class="btn btn-danger btn-sm" onclick="eliminarConsulta(${h.id})">Eliminar</button>
          </div>
          <div style="font-size:13px;color:var(--ink-soft);line-height:1.7;">
            ${h.peso ? `<div><strong>Peso:</strong> ${h.peso} kg</div>` : ''}
            ${h.temperatura ? `<div><strong>Temp:</strong> ${h.temperatura} °C</div>` : ''}
            ${h.diagnostico ? `<div><strong>Diagnóstico:</strong> ${h.diagnostico}</div>` : ''}
            ${h.tratamiento ? `<div><strong>Tratamiento:</strong> ${h.tratamiento}</div>` : ''}
            ${h.medicamentos ? `<div><strong>Medicamentos:</strong> ${h.medicamentos}</div>` : ''}
            ${h.recomendaciones ? `<div><strong>Recomendaciones:</strong> ${h.recomendaciones}</div>` : ''}
            ${h.proximo_control ? `<div><strong>Próximo control:</strong> ${fmtFecha(h.proximo_control)}</div>` : ''}
          </div>
        </div>
      `).join('') : '<p style="color:var(--ink-soft);font-size:13.5px;">Sin consultas registradas aún.</p>'}
    </div>
  `;
}
function abrirNuevaConsulta() {
  if (!_pacienteHistoriaActivo) return;
  document.getElementById('mConsultaSub').textContent = 'Registro de historia clínica';
  ['hc_fecha', 'hc_proximo', 'hc_motivo', 'hc_anamnesis', 'hc_peso', 'hc_temp', 'hc_fc', 'hc_fr', 'hc_diagnostico', 'hc_tratamiento', 'hc_medicamentos', 'hc_recomendaciones']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('hc_fecha').value = new Date().toISOString().slice(0, 10);
  abrirModal('mConsulta');
}
async function guardarConsulta() {
  const body = {
    paciente_id: _pacienteHistoriaActivo,
    fecha: document.getElementById('hc_fecha').value,
    proximo_control: document.getElementById('hc_proximo').value || null,
    motivo: document.getElementById('hc_motivo').value.trim(),
    anamnesis: document.getElementById('hc_anamnesis').value.trim(),
    peso: document.getElementById('hc_peso').value || null,
    temperatura: document.getElementById('hc_temp').value || null,
    fc: document.getElementById('hc_fc').value.trim(),
    fr: document.getElementById('hc_fr').value.trim(),
    diagnostico: document.getElementById('hc_diagnostico').value.trim(),
    tratamiento: document.getElementById('hc_tratamiento').value.trim(),
    medicamentos: document.getElementById('hc_medicamentos').value.trim(),
    recomendaciones: document.getElementById('hc_recomendaciones').value.trim(),
  };
  if (!body.fecha) { toast('La fecha es obligatoria', 'rojo'); return; }
  const d = await api('/api/historias', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Consulta registrada', 'verde');
  cerrarModal('mConsulta');
  cargarHistoriaPaciente();
}
async function eliminarConsulta(id) {
  if (!confirm('¿Eliminar esta consulta del historial?')) return;
  const d = await api(`/api/historias/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Consulta eliminada', 'verde');
  cargarHistoriaPaciente();
}

// ══════════════════════════════════════════════════════════════
// INVENTARIO (catálogo, cargas, descargas, stock por almacén)
// ══════════════════════════════════════════════════════════════
let _productos = [];
let _almacenes = [];
let _sdTipo = 'carga';
let _sdItems = [];

function invTab(t) {
  document.querySelectorAll('.inv-tab').forEach(b => b.classList.toggle('active', b.dataset.inv === t));
  document.querySelectorAll('.inv-view').forEach(v => v.classList.toggle('active', v.id === 'inv-' + t));
  if (t === 'catalogo') cargarProductos();
  if (t === 'descargas') cargarStockDocs('descarga');
  if (t === 'cargas') cargarStockDocs('carga');
  if (t === 'almacen') cargarStockAlmacen();
}
async function cargarAlmacenes() {
  const d = await api('/api/almacenes', { headers: authHeaders() });
  _almacenes = d.ok ? d.almacenes : [];
}

// ── Catálogo ──
function llenarFiltro(selId, label, valores) {
  const sel = document.getElementById(selId);
  const actual = sel.value;
  sel.innerHTML = `<option value="">${label}</option>` + valores.map(v => `<option value="${v}">${v}</option>`).join('');
  sel.value = valores.includes(actual) ? actual : '';
}
const unicos = (k) => [...new Set(_productos.map(p => p[k]).filter(Boolean))].sort();
async function cargarProductos() {
  const d = await api('/api/productos', { headers: authHeaders() });
  _productos = d.ok ? d.productos : [];
  llenarFiltro('inv_f_proveedor', 'Proveedor...', unicos('proveedor'));
  llenarFiltro('inv_f_linea', 'Línea...', unicos('linea'));
  llenarFiltro('inv_f_categoria', 'Categorías...', unicos('categoria'));
  [['dl_proveedor', 'proveedor'], ['dl_linea', 'linea'], ['dl_categoria', 'categoria']].forEach(([id, k]) => {
    document.getElementById(id).innerHTML = unicos(k).map(v => `<option value="${v}">`).join('');
  });
  renderProductos();
}
function estadoStock(p) {
  if (Number(p.stock) <= 0) return 'agotado';
  if (Number(p.stock) <= Number(p.stock_minimo)) return 'bajo';
  return 'ok';
}
// Pide a Cloudinary una versión pequeña y optimizada (más rápida que la original)
function thumb(url, size) {
  return url && url.includes('/upload/')
    ? url.replace('/upload/', `/upload/w_${size},h_${size},c_fill,q_auto,f_auto/`)
    : url;
}
function codigoSis(p) { return 'P' + String(p.id).padStart(5, '0'); }
function renderProductos() {
  const q = document.getElementById('inv_buscar').value.trim().toLowerCase();
  const fp = document.getElementById('inv_f_proveedor').value;
  const fl = document.getElementById('inv_f_linea').value;
  const fs = document.getElementById('inv_f_stock').value;
  const fc = document.getElementById('inv_f_categoria').value;
  const lista = _productos.filter(p =>
    (!q || [p.nombre, p.codigo_barras, p.marca].some(x => String(x || '').toLowerCase().includes(q))) &&
    (!fp || p.proveedor === fp) && (!fl || p.linea === fl) && (!fc || p.categoria === fc) &&
    (!fs || estadoStock(p) === fs));
  document.getElementById('tbProductos').innerHTML = lista.length
    ? lista.map(p => {
        const es = estadoStock(p);
        const stockHtml = `<span class="badge ${es === 'ok' ? 'b-primary' : es === 'bajo' ? 'b-accent' : 'b-danger'}">${p.stock}</span>`;
        const estado = !p.activo ? '<span class="badge b-grey">Inactivo</span>'
          : es === 'agotado' ? '<span class="badge b-danger">Agotado</span>'
          : es === 'bajo' ? '<span class="badge b-accent">Stock bajo</span>'
          : '<span class="badge b-primary">Disponible</span>';
        return `<tr>
          <td>${codigoSis(p)}</td>
          <td>
            <div class="prod-cell">
              ${p.foto_url
                ? `<a href="${p.foto_url}" target="_blank" title="Ver foto completa"><img src="${thumb(p.foto_url, 104)}" class="prod-foto" loading="lazy"></a>`
                : `<span class="prod-foto-ph">📦</span>`}
              <span class="prod-nombre">${p.nombre}</span>
            </div>
          </td>
          <td>${p.marca || '—'}</td>
          <td>${p.proveedor || '—'}</td>
          <td>${p.linea || '—'}</td>
          <td>${fmtMoney(p.precio_venta)}</td>
          <td>${stockHtml}</td>
          <td>${estado}</td>
          <td><div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" onclick="abrirEditarProducto(${p.id})">Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="abrirEditarProducto(${p.id});prTab('kardex')">Kardex</button>
            <button class="btn btn-danger btn-sm" onclick="eliminarProducto(${p.id})">Eliminar</button>
          </div></td>
        </tr>`;
      }).join('')
    : '<tr class="empty-row"><td colspan="10" style="text-align:center;">Sin productos en el inventario</td></tr>';
}
function limpiarFiltrosInv() {
  ['inv_buscar', 'inv_f_proveedor', 'inv_f_linea', 'inv_f_stock', 'inv_f_categoria'].forEach(id => document.getElementById(id).value = '');
  renderProductos();
}

// ── Modal producto ──
const PR_CAMPOS = ['nombre', 'marca', 'presentacion', 'contenido', 'proveedor', 'linea', 'categoria', 'subcategoria', 'precio_compra', 'precio_venta', 'stock_minimo', 'stock_maximo', 'frecuencia'];
function abrirCrearProducto() {
  document.getElementById('mProductoTitulo').textContent = 'Nuevo producto';
  document.getElementById('pr_id').value = '';
  PR_CAMPOS.forEach(c => document.getElementById('pr_' + c).value = '');
  document.getElementById('pr_unidad').value = 'UND';
  document.getElementById('pr_disponible').value = '1';
  document.getElementById('pr_activo').value = '1';
  document.getElementById('pr_stock_inicial').value = 0;
  document.getElementById('pr_grp_actual').style.display = 'none';
  document.getElementById('pr_grp_inicial').style.display = '';
    document.getElementById('pr_foto_preview_box').innerHTML = '<div class="prod-foto-lg-ph">📦</div>';
  _productoFotoFile = null;
  prTab('editar');
  abrirModal('mProducto');
}
function abrirEditarProducto(id) {
  const p = _productos.find(x => x.id === id); if (!p) return;
  document.getElementById('mProductoTitulo').textContent = 'Editar producto';
  document.getElementById('pr_id').value = p.id;
  document.getElementById('pr_nombre').value = p.nombre || '';
  document.getElementById('pr_marca').value = p.marca || '';
  document.getElementById('pr_presentacion').value = p.presentacion || '';
  document.getElementById('pr_contenido').value = p.contenido || '';
  document.getElementById('pr_unidad').value = p.unidad_medida || 'UND';
  document.getElementById('pr_proveedor').value = p.proveedor || '';
  document.getElementById('pr_linea').value = p.linea || '';
  document.getElementById('pr_categoria').value = p.categoria || '';
  document.getElementById('pr_subcategoria').value = p.subcategoria || '';
  document.getElementById('pr_precio_compra').value = p.precio_compra ?? '';
  document.getElementById('pr_precio_venta').value = p.precio_venta ?? '';
  document.getElementById('pr_stock_actual').value = p.stock ?? 0;
  document.getElementById('pr_stock_minimo').value = p.stock_minimo ?? '';
  document.getElementById('pr_stock_maximo').value = p.stock_maximo ?? '';
  document.getElementById('pr_frecuencia').value = p.frecuencia_dias ?? '';
  document.getElementById('pr_disponible').value = p.disponible_venta ? '1' : '0';
  document.getElementById('pr_activo').value = p.activo ? '1' : '0';
  document.getElementById('pr_grp_actual').style.display = '';
  document.getElementById('pr_grp_inicial').style.display = 'none';
    document.getElementById('pr_foto_preview_box').innerHTML = p.foto_url
    ? `<img src="${thumb(p.foto_url, 240)}" class="prod-foto-lg">`
    : '<div class="prod-foto-lg-ph">📦</div>';
  _productoFotoFile = null;
  prTab('editar');
  abrirModal('mProducto');
}



let _kardexMov = [];
let _kardexProd = null;

async function prTab(t) {
  document.getElementById('pr_tab_editar').classList.toggle('active', t === 'editar');
  document.getElementById('pr_tab_kardex').classList.toggle('active', t === 'kardex');
  document.getElementById('pr_panel_editar').style.display = t === 'editar' ? '' : 'none';
  document.getElementById('pr_panel_kardex').style.display = t === 'kardex' ? '' : 'none';
  if (t !== 'kardex') return;

  const id = document.getElementById('pr_id').value;
  const tb = document.getElementById('tbKardex');
  if (!id) {
    document.getElementById('kx_head').innerHTML = '';
    document.getElementById('kx_stats').innerHTML = '';
    tb.innerHTML = '<tr class="empty-row"><td colspan="8">Guarda el producto para ver su kardex</td></tr>';
    return;
  }
  _kardexProd = _productos.find(x => String(x.id) === String(id)) || null;
  tb.innerHTML = '<tr class="empty-row"><td colspan="8">Cargando...</td></tr>';
  const d = await api(`/api/productos/${id}/kardex`, { headers: authHeaders() });
  _kardexMov = (d.ok ? d.movimientos : []).slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // llenar filtro de almacenes
  const almacenes = [...new Set(_kardexMov.map(m => m.almacen_nombre).filter(Boolean))];
  const sel = document.getElementById('kx_f_almacen');
  sel.innerHTML = '<option value="">Todos los almacenes</option>' + almacenes.map(a => `<option>${a}</option>`).join('');
  document.getElementById('kx_f_tipo').value = '';

  renderKardexResumen();
  renderKardex();
}

function kxFechaHora(v) {
  const d = new Date(v);
  if (isNaN(d)) return fmtFecha(v);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '<small>' + d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) + '</small>';
}

function renderKardexResumen() {
  const p = _kardexProd;
  const entradas = _kardexMov.filter(m => m.cantidad > 0).reduce((a, m) => a + Number(m.cantidad), 0);
  const salidas = _kardexMov.filter(m => m.cantidad < 0).reduce((a, m) => a + Math.abs(Number(m.cantidad)), 0);
  const ultimo = _kardexMov[0];

  document.getElementById('kx_head').innerHTML = p ? `
    <div class="kx-prod">
      ${p.foto_url ? `<img src="${thumb(p.foto_url, 104)}" class="prod-foto">` : '<span class="prod-foto-ph">📦</span>'}
      <div>
        <div class="kx-prod-nombre">${p.nombre}</div>
        <div class="kx-prod-meta">${codigoSis(p)}${p.marca ? ' · ' + p.marca : ''}${p.proveedor ? ' · ' + p.proveedor : ''}${p.linea ? ' · ' + p.linea : ''}</div>
      </div>
    </div>` : '';

  const stock = p ? Number(p.stock) : (ultimo ? Number(ultimo.saldo) : 0);
  const valor = p ? stock * Number(p.precio_compra || 0) : 0;
  const es = p ? estadoStock(p) : 'ok';
  const cls = es === 'ok' ? 'ok' : es === 'bajo' ? 'warn' : 'bad';

  document.getElementById('kx_stats').innerHTML = `
    <div class="kx-stat ${cls}"><span>Stock actual</span><strong>${stock}</strong>
      <small>${p ? `Mín. ${p.stock_minimo ?? '—'} · Máx. ${p.stock_maximo ?? '—'}` : ''}</small></div>
    <div class="kx-stat"><span>Total entradas</span><strong class="in">+${entradas}</strong><small>unidades ingresadas</small></div>
    <div class="kx-stat"><span>Total salidas</span><strong class="out">−${salidas}</strong><small>unidades egresadas</small></div>
    <div class="kx-stat"><span>Valor en inventario</span><strong>${fmtMoney(valor)}</strong>
      <small>${p ? `Compra ${fmtMoney(p.precio_compra || 0)} · Venta ${fmtMoney(p.precio_venta || 0)}` : ''}</small></div>
    <div class="kx-stat"><span>Movimientos</span><strong>${_kardexMov.length}</strong>
      <small>${ultimo ? 'Último: ' + fmtFecha(ultimo.created_at) : 'Sin movimientos'}</small></div>`;
}

function kardexFiltrado() {
  const tipo = document.getElementById('kx_f_tipo').value;
  const alm = document.getElementById('kx_f_almacen').value;
  return _kardexMov.filter(m =>
    (!tipo || (tipo === 'entrada' ? m.cantidad > 0 : m.cantidad < 0)) &&
    (!alm || m.almacen_nombre === alm));
}

function renderKardex() {
  const tb = document.getElementById('tbKardex');
  const lista = kardexFiltrado();
  document.getElementById('kx_count').textContent = `${lista.length} de ${_kardexMov.length} movimientos`;
  tb.innerHTML = lista.length
    ? lista.map(x => {
        const ent = x.cantidad > 0, c = Math.abs(Number(x.cantidad));
        return `<tr>
          <td class="kx-fecha">${kxFechaHora(x.created_at)}</td>
          <td><span class="kx-tipo ${ent ? 'in' : 'out'}">${ent ? '↓' : '↑'} ${x.tipo || (ent ? 'entrada' : 'salida')}</span></td>
          <td>${x.almacen_nombre || '—'}</td>
          <td class="kx-num in">${ent ? '+' + c : ''}</td>
          <td class="kx-num out">${!ent ? '−' + c : ''}</td>
          <td class="kx-num kx-saldo">${x.saldo}</td>
          <td>${x.motivo || '—'}</td>
          <td>${x.usuario_nombre || '—'}</td>
        </tr>`;
      }).join('')
    : '<tr class="empty-row"><td colspan="8">Sin movimientos</td></tr>';
}

function exportarKardex() {
  const lista = kardexFiltrado();
  if (!lista.length) { toast('No hay movimientos para exportar'); return; }
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const filas = [['Fecha', 'Tipo', 'Almacén', 'Cantidad', 'Saldo', 'Motivo', 'Usuario']]
    .concat(lista.map(m => [new Date(m.created_at).toLocaleString('es-EC'), m.tipo, m.almacen_nombre, m.cantidad, m.saldo, m.motivo, m.usuario_nombre]));
  const csv = '\ufeff' + filas.map(f => f.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `kardex-${_kardexProd ? codigoSis(_kardexProd) : 'producto'}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}



let _productoFotoFile = null;
let _guardandoProducto = false;
function previsualizarFotoProducto(e) {
  const file = e.target.files[0];
  if (!file) return;
  _productoFotoFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
        document.getElementById('pr_foto_preview_box').innerHTML = `<img src="${ev.target.result}" class="prod-foto-lg">`;
  };
  reader.readAsDataURL(file);
}
async function subirFotoProductoSiHay(productoId) {
  if (!_productoFotoFile) return true;
  const fd = new FormData();
  fd.append('foto', _productoFotoFile);
  try {
    const res = await fetch(API + `/api/productos/${productoId}/foto`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }, body: fd
    });
    const data = await res.json();
    _productoFotoFile = null;
    if (!data.ok) { toast('Error subiendo foto: ' + (data.error || 'desconocido'), 'rojo'); return false; }
    return true;
  } catch (e) {
    toast('Error de red subiendo la foto', 'rojo');
    _productoFotoFile = null;
    return false;
  }
}
async function guardarProducto() {
  if (_guardandoProducto) return;
  const id = document.getElementById('pr_id').value;
  const v = (c) => document.getElementById('pr_' + c).value.trim();
  const body = {
    nombre: v('nombre'), marca: v('marca'),
    presentacion: v('presentacion'), contenido: v('contenido'), unidad_medida: v('unidad'),
    proveedor: v('proveedor'), linea: v('linea'), categoria: v('categoria'), subcategoria: v('subcategoria'),
    precio_compra: v('precio_compra') || 0, precio_venta: v('precio_venta') || 0,
    stock_minimo: v('stock_minimo'), stock_maximo: v('stock_maximo'),
    frecuencia_dias: v('frecuencia') || null,
    disponible_venta: v('disponible'), activo: v('activo'),
  };
  if (!id) body.stock_inicial = v('stock_inicial') || 0;
  if (!body.nombre || !body.linea || !body.categoria || body.stock_minimo === '' || body.stock_maximo === '') {
    toast('Completa los campos obligatorios (*)', 'rojo'); return;
  }
  _guardandoProducto = true;
  const btn = document.getElementById('pr_btn_guardar');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const d = await api(id ? `/api/productos/${id}` : '/api/productos', {
      method: id ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(body)
    });
    if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
    const fotoOk = await subirFotoProductoSiHay(id || d.id);
    cerrarModal('mProducto');
    cargarProductos();
    if (fotoOk !== false) toast('Producto guardado', 'verde');
  } finally {
    _guardandoProducto = false;
    btn.disabled = false; btn.textContent = '+ Guardar cambios';
  }
}
async function eliminarProducto(id) {
  if (!confirm('¿Eliminar este producto del inventario?')) return;
  const d = await api(`/api/productos/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Producto eliminado', 'verde');
  cargarProductos();
}

// ── Cargas / Descargas ──
async function cargarStockDocs(tipo) {
  const tb = document.getElementById(tipo === 'carga' ? 'tbCargas' : 'tbDescargas');
  const d = await api(`/api/stock-documentos?tipo=${tipo}`, { headers: authHeaders() });
  const docs = d.ok ? d.documentos : [];
  tb.innerHTML = docs.length
    ? docs.map(x => `<tr>
        <td>${x.numero}</td><td>${fmtFecha(x.created_at)}</td><td>${x.motivo || '—'}</td>
        <td>${x.almacen_nombre || '—'}</td><td>${x.responsable || '—'}</td>
        <td>${tipo === 'carga' ? fmtMoney(x.total) : (x.registrado_por || '—')}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="verStockDoc(${x.id})">Ver</button></td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="7" style="text-align:center;">Sin registros</td></tr>';
}
async function abrirStockDoc(tipo) {
  _sdTipo = tipo; _sdItems = [];
  await Promise.all([cargarAlmacenes(), cargarProductos()]);
  document.getElementById('sd_titulo').textContent = tipo === 'carga' ? 'Cargar stock' : 'Descargar stock';
  document.getElementById('sd_lbl_almacen').textContent = tipo === 'carga' ? 'Almacén destino' : 'Almacén origen';
  document.getElementById('sd_almacen').innerHTML = _almacenes.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');
  const ops = tipo === 'carga' ? ['Compra a proveedor', 'Corrección', 'Donación', 'Otro'] : ['Corrección', 'Merma / vencido', 'Consumo interno', 'Otro'];
  document.getElementById('sd_operacion').innerHTML = ops.map(o => `<option>${o}</option>`).join('');
  ['sd_responsable', 'sd_motivo', 'sd_buscar'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sd_resultados').style.display = 'none';
  document.getElementById('sd_btn').textContent = tipo === 'carga' ? '+ Cargar' : '+ Descargar';
  sdRender();
  abrirModal('mStockDoc');
}
function sdBuscar(term) {
  const box = document.getElementById('sd_resultados');
  const q = term.trim().toLowerCase();
  if (!q) { box.style.display = 'none'; return; }
  const r = _productos.filter(p => String(p.nombre).toLowerCase().includes(q) || String(p.codigo_barras || '').toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = r.length
    ? r.map(p => `<div class="search-result-item" onclick="sdAgregar(${p.id})"><span>${p.nombre}</span><span style="color:var(--ink-soft);">stock: ${p.stock}</span></div>`).join('')
    : '<div class="search-empty">Sin resultados</div>';
  box.style.display = 'block';
}
function sdAgregar(id) {
  const p = _productos.find(x => x.id === id); if (!p) return;
  if (!_sdItems.find(i => i.producto_id === id)) {
    _sdItems.push({ producto_id: p.id, codigo_barras: p.codigo_barras, nombre: p.nombre, precio_compra: p.precio_compra, precio_venta: p.precio_venta, cantidad: 1 });
  }
  document.getElementById('sd_buscar').value = '';
  document.getElementById('sd_resultados').style.display = 'none';
  sdRender();
}
function sdSet(i, campo, val) { _sdItems[i][campo] = val; sdTotal(); }
function sdQuitar(i) { _sdItems.splice(i, 1); sdRender(); }
function sdTotal() {
  const t = _sdItems.reduce((a, i) => a + (Number(i.precio_compra) || 0) * (parseInt(i.cantidad) || 0), 0);
  document.getElementById('sd_total').textContent = _sdTipo === 'carga' && _sdItems.length ? 'Total compra: ' + fmtMoney(t) : '';
}
function sdRender() {
  const carga = _sdTipo === 'carga';
  document.getElementById('sd_items').innerHTML = _sdItems.length
    ? _sdItems.map((it, i) => `<tr>
        <td>${it.codigo_barras || '—'}</td><td>${it.nombre}</td>
        <td>${carga ? `<input type="number" step="0.01" value="${it.precio_compra}" style="width:90px;" oninput="sdSet(${i},'precio_compra',this.value)">` : fmtMoney(it.precio_compra)}</td>
        <td>${carga ? `<input type="number" step="0.01" value="${it.precio_venta}" style="width:90px;" oninput="sdSet(${i},'precio_venta',this.value)">` : fmtMoney(it.precio_venta)}</td>
        <td style="text-align:center;"><input type="number" min="1" value="${it.cantidad}" style="width:70px;" oninput="sdSet(${i},'cantidad',this.value)"></td>
        <td><button class="btn btn-danger btn-sm" onclick="sdQuitar(${i})">✕</button></td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="6" style="text-align:center;">Busca y agrega productos</td></tr>';
  sdTotal();
}
let _guardandoDoc = false;
async function sdGuardar() {
  if (_guardandoDoc) return;
  const body = {
    tipo: _sdTipo,
    almacen_id: document.getElementById('sd_almacen').value,
    motivo: document.getElementById('sd_motivo').value.trim(),
    tipo_operacion: document.getElementById('sd_operacion').value,
    responsable: document.getElementById('sd_responsable').value.trim(),
    items: _sdItems,
  };
  if (!body.motivo) { toast('El motivo es obligatorio', 'rojo'); return; }
  if (!_sdItems.length) { toast('Agrega al menos un producto', 'rojo'); return; }
  _guardandoDoc = true;
  const btn = document.getElementById('sd_btn');
  const txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const d = await api('/api/stock-documentos', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
    toast(_sdTipo === 'carga' ? 'Stock cargado' : 'Stock descargado', 'verde');
    cerrarModal('mStockDoc');
    cargarProductos();
    cargarStockDocs(_sdTipo);
  } finally {
    _guardandoDoc = false;
    btn.disabled = false; btn.textContent = txt;
  }
}
async function verStockDoc(id) {
  document.getElementById('sdd_contenido').innerHTML = 'Cargando...';
  abrirModal('mStockDetalle');
  const d = await api(`/api/stock-documentos/${id}`, { headers: authHeaders() });
  if (!d.ok) { document.getElementById('sdd_contenido').innerHTML = d.error || 'Error'; return; }
  const x = d.documento;
  document.getElementById('sdd_contenido').innerHTML = `
    <h2>${x.tipo === 'carga' ? 'Carga' : 'Descarga'} #${x.numero}</h2>
    <p class="modal-sub">${fmtFecha(x.created_at)} — ${x.almacen_nombre || ''} — ${x.motivo || ''}${x.responsable ? ' — Resp: ' + x.responsable : ''}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Cód. barras</th><th>Concepto</th><th>P. compra</th><th>P. venta</th><th>Cantidad</th></tr></thead>
      <tbody>${x.items.map(i => `<tr><td>${i.codigo_barras || '—'}</td><td>${i.nombre}</td><td>${fmtMoney(i.precio_compra)}</td><td>${fmtMoney(i.precio_venta)}</td><td>${i.cantidad}</td></tr>`).join('')}</tbody>
    </table></div>
    ${x.tipo === 'carga' ? `<div style="text-align:right;font-weight:800;margin-top:10px;">Total: ${fmtMoney(x.total)}</div>` : ''}`;
}

// ── Stock por almacén ──
let _stockFilas = [];
async function cargarStockAlmacen() {
  await Promise.all([cargarAlmacenes(), cargarProductos()]);
  const sel = document.getElementById('sa_almacen');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Almacén...</option>' + _almacenes.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');
  sel.value = actual;
  const d = await api('/api/stock-almacen', { headers: authHeaders() });
  _stockFilas = d.ok ? d.filas : [];
  renderStockAlmacen();
}
function renderStockAlmacen() {
  const q = document.getElementById('sa_buscar').value.trim().toLowerCase();
  const al = document.getElementById('sa_almacen').value;
  const lista = _stockFilas.filter(f => (!q || String(f.nombre).toLowerCase().includes(q)) && (!al || String(f.almacen_id) === al));
  document.getElementById('tbStockAlmacen').innerHTML = lista.length
    ? lista.map(f => {
        const prod = _productos.find(p => String(p.id) === String(f.producto_id));
        const foto = f.foto_url || prod?.foto_url;
        return `<tr>
          <td>
            <div class="prod-cell">
              ${foto
                ? `<a href="${foto}" target="_blank" title="Ver foto completa"><img src="${thumb(foto, 104)}" class="prod-foto" loading="lazy"></a>`
                : `<span class="prod-foto-ph">📦</span>`}
              <span class="prod-nombre">${f.nombre}</span>
            </div>
          </td>
          <td>${fmtMoney(f.precio_compra)}</td>
          <td>${fmtMoney(f.precio_venta)}</td>
          <td>${f.almacen}</td>
          <td>${f.stock}</td>
        </tr>`;
      }).join('')
    : '<tr class="empty-row"><td colspan="5" style="text-align:center;">Sin datos</td></tr>';
}
async function crearAlmacen() {
  const nombre = prompt('Nombre del nuevo almacén:');
  if (!nombre || !nombre.trim()) return;
  const d = await api('/api/almacenes', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ nombre: nombre.trim() }) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Almacén creado', 'verde');
  cargarStockAlmacen();
}
document.addEventListener('click', (e) => {
  const box = document.getElementById('sd_resultados');
  if (box && !e.target.closest('#sd_buscar') && !box.contains(e.target)) box.style.display = 'none';
});
// ══════════════════════════════════════════════════════════════
// VENTAS
// ══════════════════════════════════════════════════════════════
let _ventas = [];
let _itemsVenta = [];
async function cargarVentas() {
  const d = await api('/api/ventas', { headers: authHeaders() });
  _ventas = d.ok ? d.ventas : [];
  renderVentas();
}
function renderVentas() {
  document.getElementById('tbVentas').innerHTML = _ventas.length
    ? _ventas.map(v => `<tr>
        <td>${fmtFecha(v.created_at)}</td>
        <td>${v.cliente_nombre || '—'}</td>
        <td>${v.paciente_nombre || '—'}</td>
        <td><strong>${fmtMoney(v.total)}</strong></td>
        <td><span class="badge ${v.estado_pago === 'pagado' ? 'b-primary' : 'b-accent'}">${v.estado_pago}</span></td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" onclick="verComprobante(${v.id})">Ver</button>
            ${v.estado_pago !== 'pagado' ? `<button class="btn btn-primary btn-sm" onclick="registrarPago(${v.id})">Registrar pago</button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="eliminarVenta(${v.id})">Eliminar</button>
          </div>
        </td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="6">Aún no tienes ventas registradas</td></tr>';
}
async function abrirCrearVenta() {
  await Promise.all([asegurarClientesCargados(), cargarProductosParaVenta()]);
  poblarSelectClientes('ve_cliente_id');
  document.getElementById('ve_paciente_id').innerHTML = '<option value="">—</option>';
  document.getElementById('ve_descuento').value = 0;
  document.getElementById('ve_estado_pago').value = 'pagado';
  document.getElementById('ve_item_nombre').value = '';
  document.getElementById('ve_item_precio').value = '';
  _itemsVenta = [];
  renderItemsVenta();
  abrirModal('mVenta');
}
async function cargarProductosParaVenta() {
  const d = await api('/api/productos', { headers: authHeaders() });
  _productos = d.ok ? d.productos : [];
  const sel = document.getElementById('ve_producto_select');
  sel.innerHTML = _productos.map(p => `<option value="${p.id}">${p.nombre} — ${fmtMoney(p.precio_venta)} (stock: ${p.stock})</option>`).join('')
    || '<option value="">Sin productos en inventario</option>';
}
function agregarItemDesdeInventario() {
  const sel = document.getElementById('ve_producto_select');
  const id = sel.value;
  const p = _productos.find(x => String(x.id) === String(id));
  if (!p) { toast('Agrega productos al inventario primero'); return; }
  _itemsVenta.push({ producto_id: p.id, nombre: p.nombre, precio: Number(p.precio_venta), cantidad: 1 });
  renderItemsVenta();
}
function agregarItemLibre() {
  const nombre = document.getElementById('ve_item_nombre').value.trim();
  const precio = Number(document.getElementById('ve_item_precio').value || 0);
  if (!nombre || !precio) { toast('Escribe un nombre y un precio válido', 'rojo'); return; }
  _itemsVenta.push({ nombre, precio, cantidad: 1 });
  document.getElementById('ve_item_nombre').value = '';
  document.getElementById('ve_item_precio').value = '';
  renderItemsVenta();
}
function cambiarCantidadItem(i, delta) {
  _itemsVenta[i].cantidad = Math.max(1, (_itemsVenta[i].cantidad || 1) + delta);
  renderItemsVenta();
}
function quitarItemVenta(i) {
  _itemsVenta.splice(i, 1);
  renderItemsVenta();
}
function renderItemsVenta() {
  const list = document.getElementById('ve_items_list');
  list.innerHTML = _itemsVenta.length
    ? _itemsVenta.map((it, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13.5px;">
        <div style="flex:1;">${it.nombre}</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button type="button" class="btn btn-ghost btn-sm" onclick="cambiarCantidadItem(${i},-1)">−</button>
          <span>${it.cantidad}</span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="cambiarCantidadItem(${i},1)">+</button>
        </div>
        <div style="width:70px;text-align:right;font-weight:700;">${fmtMoney(it.precio * it.cantidad)}</div>
        <button type="button" class="btn btn-danger btn-sm" onclick="quitarItemVenta(${i})">✕</button>
      </div>`).join('')
    : '<p style="color:var(--ink-soft);font-size:13px;">Aún no has agregado productos o servicios</p>';
  const subtotal = _itemsVenta.reduce((a, it) => a + it.precio * it.cantidad, 0);
  const descuento = Number(document.getElementById('ve_descuento').value || 0);
  const total = Math.max(subtotal - descuento, 0);
  document.getElementById('ve_total_txt').textContent = fmtMoney(total);
}
async function guardarVenta() {
  if (!_itemsVenta.length) { toast('Agrega al menos un producto o servicio', 'rojo'); return; }
  const body = {
    cliente_id: document.getElementById('ve_cliente_id').value || null,
    paciente_id: document.getElementById('ve_paciente_id').value || null,
    items: _itemsVenta,
    descuento: document.getElementById('ve_descuento').value || 0,
    metodo_pago: document.getElementById('ve_metodo').value,
    estado_pago: document.getElementById('ve_estado_pago').value,
  };
  const d = await api('/api/ventas', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast(`Venta registrada por ${fmtMoney(d.total)}`, 'verde');
  cerrarModal('mVenta');
  cargarVentas();
}
async function eliminarVenta(id) {
  if (!confirm('¿Eliminar esta venta?')) return;
  const d = await api(`/api/ventas/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Venta eliminada', 'verde');
  cargarVentas();
}
async function registrarPago(id) {
  const d = await api(`/api/ventas/${id}/pago`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({}) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Pago registrado', 'verde');
  cargarVentas();
}
function verComprobante(id) {
  const v = _ventas.find(x => x.id === id); if (!v) return;
  let items = [];
  try { items = typeof v.items_json === 'string' ? JSON.parse(v.items_json) : (v.items_json || []); } catch (e) { items = []; }
  document.getElementById('cp_contenido').innerHTML = `
    <p class="modal-sub">${fmtFecha(v.created_at)} — ${v.cliente_nombre || 'Sin cliente'}${v.paciente_nombre ? ' · ' + v.paciente_nombre : ''}</p>
    <div style="margin:14px 0;">
      ${items.map(it => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13.5px;">
        <span>${it.nombre} ${it.cantidad > 1 ? '× ' + it.cantidad : ''}</span><span>${fmtMoney(it.precio * (it.cantidad || 1))}</span>
      </div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13.5px;"><span>Subtotal</span><span>${fmtMoney(v.subtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13.5px;"><span>Descuento</span><span>-${fmtMoney(v.descuento)}</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:800;font-size:16px;margin-top:6px;"><span>Total</span><span>${fmtMoney(v.total)}</span></div>
    <p style="margin-top:10px;color:var(--ink-soft);font-size:12.5px;">Método: ${v.metodo_pago} — Estado: ${v.estado_pago}</p>
  `;
  abrirModal('mComprobante');
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD "INICIO" — resumen rediseñado
// ══════════════════════════════════════════════════════════════
async function cargarResumen() {
  const d = await api('/api/resumen', { headers: authHeaders() });
  if (!d.ok) return;

  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('greetingTitle').textContent = `${saludo}, ${(user.nombre || user.nombre_clinica || '').split(' ')[0] || ''}`;

  document.getElementById('st-citasHoy').textContent = d.citasHoy;
  document.getElementById('st-enEspera').textContent = d.enEspera;
  document.getElementById('st-ventasHoy').textContent = fmtMoney(d.ventasHoy);
  document.getElementById('st-alertas').textContent = d.alertas;

  const citasBox = document.getElementById('inicioProximasCitas');
  citasBox.innerHTML = (d.proximasCitas || []).length
    ? d.proximasCitas.map(c => `
      <div class="inicio-list-item">
        <span class="inicio-hora">${c.hora ? c.hora.slice(0,5) : '—'}</span>
        <span style="flex:1;">${c.paciente_nombre || '—'} — ${c.motivo || 'Consulta'}</span>
        <span class="badge ${estadoBadge[c.estado] || 'b-grey'}">${c.estado}</span>
      </div>`).join('')
    : '<p style="color:var(--ink-soft);font-size:13px;">No hay más citas para hoy.</p>';

  let alertHtml = '';
  if (d.stockBajo > 0) alertHtml += `<div class="alert-item">📦 ${d.stockBajo} producto(s) con stock bajo</div>`;
  if (d.enEspera > 0) alertHtml += `<div class="alert-item">⏳ ${d.enEspera} paciente(s) en espera</div>`;
  document.getElementById('inicioAlertas').innerHTML = alertHtml || '<p style="color:var(--ink-soft);font-size:13px;">Sin alertas por ahora.</p>';
}

// ══════════════════════════════════════════════════════════════
// BÚSQUEDA GLOBAL
// ══════════════════════════════════════════════════════════════
let _searchTimer = null;
function buscarGlobal(term) {
  clearTimeout(_searchTimer);
  const box = document.getElementById('searchResults');
  if (!term.trim()) { box.classList.remove('open'); return; }
  _searchTimer = setTimeout(async () => {
    const d = await api('/api/buscar?q=' + encodeURIComponent(term), { headers: authHeaders() });
    if (!d.ok) return;
    let html = '';
    if (d.pacientes.length) {
      html += '<div class="search-results-group">Pacientes</div>';
      html += d.pacientes.map(p => `<div class="search-result-item" onclick="cerrarBusqueda();abrirFichaPaciente(${p.id})"><span>🐾 ${p.nombre}</span><span style="color:var(--ink-soft);">${p.cliente_nombre}</span></div>`).join('');
    }
    if (d.clientes.length) {
      html += '<div class="search-results-group">Clientes</div>';
      html += d.clientes.map(c => `<div class="search-result-item" onclick="cerrarBusqueda();ir('clientes')"><span>👤 ${c.nombre}</span><span style="color:var(--ink-soft);">${c.telefono || ''}</span></div>`).join('');
    }
    if (!html) html = '<div class="search-empty">Sin resultados</div>';
    box.innerHTML = html;
    box.classList.add('open');
  }, 300);
}
function cerrarBusqueda() {
  document.getElementById('searchResults').classList.remove('open');
  document.getElementById('globalSearch').value = '';
}
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.search-bar-wrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('searchResults')?.classList.remove('open');
});

// ══════════════════════════════════════════════════════════════
// FICHA DEL PACIENTE — centro conector
// ══════════════════════════════════════════════════════════════
let _fpPacienteActivo = null;
async function abrirFichaPaciente(id) {
  await asegurarPacientesCargados();
  _fpPacienteActivo = _pacientes.find(p => p.id === id);
  if (!_fpPacienteActivo) return;
  document.getElementById('fp_nombre').textContent = _fpPacienteActivo.nombre;
  document.getElementById('fp_sub').textContent = `${_fpPacienteActivo.especie || ''} ${_fpPacienteActivo.raza ? '· ' + _fpPacienteActivo.raza : ''} — Tutor: ${_fpPacienteActivo.cliente_nombre}`;
  document.getElementById('fp_avatar').innerHTML = _fpPacienteActivo.foto_url
    ? `<img src="${_fpPacienteActivo.foto_url}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;">`
    : (_fpPacienteActivo.especie?.toLowerCase().includes('gat') ? '🐱' : '🐶');
  cambiarTabFicha('resumen');
  abrirModal('mFichaPaciente');
}
function cambiarTabFicha(tab) {
  document.getElementById('fp_tab_resumen').classList.toggle('active', tab === 'resumen');
  document.getElementById('fp_tab_historia').classList.toggle('active', tab === 'historia');
  if (tab === 'resumen') renderFichaResumen(); else renderFichaHistoria();
}
function renderFichaResumen() {
  const p = _fpPacienteActivo;
  document.getElementById('fp_contenido').innerHTML = `
    <div class="ficha-grid">
      <div class="ficha-item"><span class="ficha-label">Sexo</span><span class="ficha-val">${p.sexo || '—'}</span></div>
      <div class="ficha-item"><span class="ficha-label">Peso</span><span class="ficha-val">${p.peso ? p.peso + ' kg' : '—'}</span></div>
      <div class="ficha-item"><span class="ficha-label">Color</span><span class="ficha-val">${p.color || '—'}</span></div>
      <div class="ficha-item"><span class="ficha-label">Microchip</span><span class="ficha-val">${p.microchip || '—'}</span></div>
    </div>
    ${p.alergias ? `<div class="ficha-dr-box"><div class="ficha-dr-label">⚠️ Alergias</div><div class="ficha-dr-txt">${p.alergias}</div></div>` : ''}
    ${p.observaciones ? `<div class="ficha-dr-box"><div class="ficha-dr-label">📋 Observaciones</div><div class="ficha-dr-txt">${p.observaciones}</div></div>` : ''}
  `;
}
async function renderFichaHistoria() {
  const box = document.getElementById('fp_contenido');
  box.innerHTML = 'Cargando...';
  const d = await api(`/api/historias/${_fpPacienteActivo.id}`, { headers: authHeaders() });
  const historias = d.ok ? d.historias : [];
  box.innerHTML = historias.length ? historias.map(h => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">
      <strong style="font-size:13px;">${fmtFecha(h.fecha)}${h.motivo ? ' — ' + h.motivo : ''}</strong>
      <div style="font-size:12.5px;color:var(--ink-soft);margin-top:4px;line-height:1.6;">
        ${h.diagnostico ? `<div><strong>Diagnóstico:</strong> ${h.diagnostico}</div>` : ''}
        ${h.tratamiento ? `<div><strong>Tratamiento:</strong> ${h.tratamiento}</div>` : ''}
      </div>
    </div>`).join('') : '<p style="color:var(--ink-soft);font-size:13px;">Sin consultas registradas.</p>';
}
function fpNuevaConsulta() {
  cerrarModal('mFichaPaciente');
  ir('historia');
  document.getElementById('hc_paciente_select').value = _fpPacienteActivo.id;
  cargarHistoriaPaciente();
  abrirNuevaConsulta();
}
function fpNuevaVenta() {
  cerrarModal('mFichaPaciente');
  ir('ventas');
  abrirCrearVenta().then(() => {
    document.getElementById('ve_cliente_id').value = _fpPacienteActivo.cliente_id;
    poblarPacientesDeCliente('ve_paciente_id', _fpPacienteActivo.cliente_id).then(() => {
      document.getElementById('ve_paciente_id').value = _fpPacienteActivo.id;
    });
  });
}

// ══════════════════════════════════════════════════════════════
// FOTO DE MASCOTA (Cloudinary)
// ══════════════════════════════════════════════════════════════
let _pacienteFotoFile = null;
function previsualizarFotoPaciente(e) {
  const file = e.target.files[0];
  if (!file) return;
  _pacienteFotoFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('pa_foto_preview_box').innerHTML = `<img src="${ev.target.result}" class="pac-foto-preview">`;
  };
  reader.readAsDataURL(file);
}
async function subirFotoPacienteSiHay(pacienteId) {
  if (!_pacienteFotoFile) return true;
  const fd = new FormData();
  fd.append('foto', _pacienteFotoFile);
  try {
    const res = await fetch(API + `/api/pacientes/${pacienteId}/foto`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }, body: fd
    });
    const data = await res.json();
    _pacienteFotoFile = null;
    if (!data.ok) { toast('Error subiendo foto: ' + (data.error || 'desconocido'), 'rojo'); return false; }
    return true;
  } catch (e) {
    toast('Error de red subiendo la foto', 'rojo');
    _pacienteFotoFile = null;
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// ATENCIÓN — sala de espera (flujo central)
// ══════════════════════════════════════════════════════════════
let _atenciones = [];
const prioridadLabel = { emergencia: 'Emergencia', urgente: 'Urgente', prioritario: 'Prioritario', normal: 'Normal' };
const estadoAtencionLabel = { llegada: 'Llegada', triaje: 'Triaje', espera: 'En espera', consulta: 'Consulta', diagnostico: 'Diagnóstico', tratamiento: 'Tratamiento', venta: 'Venta/Pago', seguimiento: 'Seguimiento', cerrada: 'Cerrada' };
const flujoEstados = ['llegada','triaje','espera','consulta','diagnostico','tratamiento','venta','seguimiento','cerrada'];

async function cargarAtenciones() {
  await asegurarVeterinariosCargados();
  const d = await api('/api/atenciones', { headers: authHeaders() });
  _atenciones = d.ok ? d.atenciones : [];
  renderAtenciones();
}
function renderAtenciones() {
  const box = document.getElementById('atencionLista');
  if (!_atenciones.length) { box.innerHTML = '<p style="color:var(--ink-soft);font-size:13.5px;">No hay pacientes en atención activa.</p>'; return; }
  box.innerHTML = _atenciones.map(a => {
    const idx = flujoEstados.indexOf(a.estado);
    const siguiente = flujoEstados[idx + 1];
    return `
    <div class="atencion-card ${a.prioridad}">
      <div style="flex:1;">
        <strong>${a.paciente_nombre}</strong> <span style="color:var(--ink-soft);font-size:13px;">— ${a.cliente_nombre}</span>
        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
          <span class="badge b-${a.prioridad}">${prioridadLabel[a.prioridad]}</span>
          <span class="badge b-grey">${estadoAtencionLabel[a.estado]}</span>
          ${a.veterinario_nombre ? `<span class="badge b-primary">${a.veterinario_nombre}</span>` : `<select onchange="asignarVeterinario(${a.id}, this.value)" style="padding:2px 6px;border-radius:6px;border:1px solid var(--border);font-size:11.5px;">${['<option value="">Asignar vet.</option>'].concat(_veterinarios.map(v=>`<option value="${v.id}">${v.nombre}</option>`)).join('')}</select>`}
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-sm" onclick="abrirFichaPaciente(${a.paciente_id})">Ver ficha</button>
        ${siguiente && siguiente !== 'cerrada' ? `<button class="btn btn-primary btn-sm" onclick="avanzarAtencion(${a.id},'${siguiente}')">Avanzar → ${estadoAtencionLabel[siguiente]}</button>` : ''}
        ${siguiente === 'cerrada' ? `<button class="btn btn-primary btn-sm" onclick="avanzarAtencion(${a.id},'cerrada')">Cerrar atención</button>` : ''}
      </div>
    </div>`;
  }).join('');
}
async function asignarVeterinario(id, veterinario_id) {
  if (!veterinario_id) return;
  const d = await api(`/api/atenciones/${id}/asignar`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ veterinario_id }) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Veterinario asignado', 'verde');
  cargarAtenciones();
}
async function avanzarAtencion(id, estado) {
  const d = await api(`/api/atenciones/${id}/estado`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ estado }) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Atención actualizada', 'verde');
  cargarAtenciones();
}
async function abrirCrearAtencion() {
  await Promise.all([asegurarClientesCargados(), asegurarVeterinariosCargados()]);
  poblarSelectClientes('at_cliente_id');
  poblarSelectVeterinarios('at_veterinario_id');
  document.getElementById('at_paciente_id').innerHTML = '<option value="">— Selecciona un cliente primero —</option>';
  document.getElementById('at_origen').value = 'sin_cita';
  document.getElementById('at_prioridad').value = 'normal';
  abrirModal('mAtencion');
}
async function guardarAtencion() {
  const cliente_id = document.getElementById('at_cliente_id').value;
  const paciente_id = document.getElementById('at_paciente_id').value;
  if (!cliente_id || !paciente_id) { toast('Selecciona cliente y mascota', 'rojo'); return; }
  const body = {
    cliente_id, paciente_id,
    veterinario_id: document.getElementById('at_veterinario_id').value || null,
    origen: document.getElementById('at_origen').value,
    prioridad: document.getElementById('at_prioridad').value,
  };
  const d = await api('/api/atenciones', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Atención registrada', 'verde');
  cerrarModal('mAtencion');
  cargarAtenciones();
}

// ══════════════════════════════════════════════════════════════
// PERSONAL — el propietario administra a su equipo
// ══════════════════════════════════════════════════════════════
let _personal = [];
const rolPersonalLabel = { propietario: 'Propietario', veterinario: 'Veterinario', recepcion: 'Recepción' };
async function cargarPersonal() {
  const d = await api('/api/personal', { headers: authHeaders() });
  _personal = d.ok ? d.personal : [];
  document.getElementById('tbStaff').innerHTML = _personal.length
    ? _personal.map(s => `<tr>
        <td><strong>${s.nombre || '—'}</strong></td>
        <td>${s.email}</td>
        <td><span class="badge b-primary">${rolPersonalLabel[s.rol] || s.rol}</span></td>
        <td>${s.activo ? '<span class="badge b-primary">Activa</span>' : '<span class="badge b-danger">Desactivada</span>'}</td>
        <td>${s.rol === 'propietario' ? '' : `<button class="btn btn-ghost btn-sm" onclick="abrirEditarPersonal(${s.id})">Editar</button>`}</td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="5">Sin personal registrado</td></tr>';
}
function abrirEditarPersonal(id) {
  const s = _personal.find(x => x.id === id); if (!s) return;
  document.getElementById('st_id').value = s.id;
  document.getElementById('mStaffSub').textContent = `${rolPersonalLabel[s.rol]} — ${s.email}`;
  document.getElementById('st_nombre').value = s.nombre || '';
  document.getElementById('st_password').value = '';
  document.getElementById('st_activo').value = s.activo ? '1' : '0';
  abrirModal('mStaff');
}
async function guardarPersonal() {
  const id = document.getElementById('st_id').value;
  const body = {
    nombre: document.getElementById('st_nombre').value.trim(),
    activo: document.getElementById('st_activo').value,
    password: document.getElementById('st_password').value || undefined,
  };
  const d = await api(`/api/personal/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Personal actualizado', 'verde');
  cerrarModal('mStaff');
  cargarPersonal();
}

// ══════════════════════════════════════════════════════════════
// CAJA
// ══════════════════════════════════════════════════════════════
async function cargarCaja() {
  const desde = document.getElementById('cj_desde').value;
  const hasta = document.getElementById('cj_hasta').value;
  const qs = desde && hasta ? `?desde=${desde}&hasta=${hasta}` : '';
  const d = await api('/api/caja' + qs, { headers: authHeaders() });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  if (!desde) document.getElementById('cj_desde').value = d.desde;
  if (!hasta) document.getElementById('cj_hasta').value = d.hasta;
  document.getElementById('cj-total').textContent = fmtMoney(d.total);
  document.getElementById('cj-cantidad').textContent = d.cantidad;
  document.getElementById('cj-pendiente').textContent = fmtMoney(d.pendiente?.total || 0);
  document.getElementById('tbCajaMetodo').innerHTML = d.porMetodo.length
    ? d.porMetodo.map(m => `<tr><td>${m.metodo}</td><td>${m.cantidad}</td><td>${fmtMoney(m.total)}</td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="3">Sin movimientos en este rango</td></tr>';
  document.getElementById('tbCajaDia').innerHTML = (d.porDia || []).length
    ? d.porDia.map(x => `<tr><td>${fmtFecha(x.dia)}</td><td>${x.cantidad}</td><td>${fmtMoney(x.total)}</td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="3">Sin datos</td></tr>';
}

// ══════════════════════════════════════════════════════════════
// REPORTES
// ══════════════════════════════════════════════════════════════
async function cargarReportes() {
  const desde = document.getElementById('rp_desde').value;
  const hasta = document.getElementById('rp_hasta').value;
  const qs = desde && hasta ? `?desde=${desde}&hasta=${hasta}` : '';
  const d = await api('/api/reportes' + qs, { headers: authHeaders() });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  if (!desde) document.getElementById('rp_desde').value = d.desde;
  if (!hasta) document.getElementById('rp_hasta').value = d.hasta;
  document.getElementById('rp-consultas').textContent = d.consultas ?? '—';
  document.getElementById('tbRepCitas').innerHTML = d.citasPorEstado.length
    ? d.citasPorEstado.map(c => `<tr><td>${c.estado}</td><td>${c.total}</td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="2">Sin datos</td></tr>';
  document.getElementById('tbRepVet').innerHTML = (d.porVeterinario || []).length
    ? d.porVeterinario.map(v => `<tr><td>${v.veterinario}</td><td>${v.total}</td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="2">Sin datos</td></tr>';
  document.getElementById('tbRepProductos').innerHTML = (d.topProductos || []).length
    ? d.topProductos.map(p => `<tr><td>${p.nombre}</td><td>${p.cantidad}</td><td>${fmtMoney(p.total)}</td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="3">Sin datos</td></tr>';
}

// ══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════
async function cargarConfiguracion() {
  const d = await api('/api/configuracion', { headers: authHeaders() });
  if (!d.ok) return;
  document.getElementById('cf_nombre').value = d.configuracion.nombre_clinica || '';
  document.getElementById('cf_plan').value = d.configuracion.plan_nombre || 'Sin plan';
  document.getElementById('cf_pass_actual').value = '';
  document.getElementById('cf_pass_nueva').value = '';
}
async function guardarConfiguracion() {
  const nombre_clinica = document.getElementById('cf_nombre').value.trim();
  if (!nombre_clinica) { toast('El nombre de la clínica es obligatorio', 'rojo'); return; }
  const d = await api('/api/configuracion', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ nombre_clinica }) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Clínica actualizada', 'verde');
  document.getElementById('clinicaTag').textContent = user.plan_nombre || nombre_clinica;
}
async function cambiarPassword() {
  const actual = document.getElementById('cf_pass_actual').value;
  const nueva = document.getElementById('cf_pass_nueva').value;
  if (!actual || !nueva) { toast('Completa ambos campos', 'rojo'); return; }
  const d = await api('/api/auth/password', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ actual, nueva }) });
  if (!d.ok) { toast(d.error || 'Error', 'rojo'); return; }
  toast('Contraseña actualizada', 'verde');
  document.getElementById('cf_pass_actual').value = '';
  document.getElementById('cf_pass_nueva').value = '';
}
async function descargarRespaldo() {
  try {
    const res = await fetch(API + '/api/respaldo', { headers: authHeaders() });
    const data = await res.json();
    if (!data.ok) { toast(data.error || 'Error generando el respaldo', 'rojo'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `respaldo-vetcore-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast('Error de red generando el respaldo', 'rojo');
  }
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
cargarResumen();
