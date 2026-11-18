import { useEffect, useMemo, useRef, useState } from 'react'



import './App.css'







const API_URL = 'https://script.google.com/macros/s/AKfycbx2l-R4qea9DvppWGhbCSC15zjtpJM7FBHWiC3eYUkN34tuwo4nIS059VcdWwm_Mivlag/exec'



type Role = 'Supervisor' | 'Manager'

type ProblemStatus = 'Pending' | 'In Progress' | 'Resolved'



type Entry = { recordId?: string; date: string; shift: string; machine: string; product: string; target: number; actual: number; good: number; rejected: number; reason: string; remarks: string; shortfallReason?: string; rejectionReason?: string }



type Machine = { id: string; name: string; type: string; status: 'Active' | 'Maintenance' | 'Inactive'; remarks: string }



type MachineTarget = { id: string; date: string; machineId: string; quantity: number; unit?: string; assignedSupervisor?: string }


type ProblemLogEntry = {
  productionDate: string;
  machineName: string;
  shift: string;
  problemType: 'Shortfall' | 'Rejection';
  shortfallReason: string;
  status: ProblemStatus;
};

type OrderRecord = {
  'Order ID': string; 'Order Date': string; 'Customer Name': string;
  'Product Name': string; 'Part Number': string; 'Order Quantity': string;
  'Material Specification': string; 'Delivery Date': string;
  Priority: string; 'Order Status': string; Remarks: string;
};
const PROCESS_SEQUENCE_MAP: Record<string, number> = {
  'Turning': 1,
  'Gear Hobbing': 2,
  'Gear Shaping': 3,
  'Heat Treatment': 4,
  'Grinding': 5,
  'Quality Inspection': 6,
  'Packing': 7,
};

// Phase 3 planning defaults (seconds per piece). These are editable estimates,
// not measured factory standards. Supervisor can override each process-machine pair.
const PHASE3_PROCESS_DEFAULTS: Array<{ processName: string; sequence: number; defaultCycleSeconds: string }> = [
  { processName: 'Turning', sequence: 1, defaultCycleSeconds: '60' },
  { processName: 'Gear Hobbing', sequence: 2, defaultCycleSeconds: '75' },
  { processName: 'Gear Shaping', sequence: 3, defaultCycleSeconds: '90' },
  { processName: 'Heat Treatment', sequence: 4, defaultCycleSeconds: '120' },
  { processName: 'Grinding', sequence: 5, defaultCycleSeconds: '80' },
  { processName: 'Quality Inspection', sequence: 6, defaultCycleSeconds: '30' },
  { processName: 'Packing', sequence: 7, defaultCycleSeconds: '20' },
];
const phase3CycleDefaultsStorageKey = 'production-monitoring-phase3-cycle-defaults-v1';

type ProcessJourneyRecord = {
  Journey_ID: string;
  Order_ID: string;
  Process_Sequence: number;
  Process_Name: string;
  Machine_ID: string;
  Planned_Qty: number;
  Received_Qty: number;
  Completed_Qty: number;
  Pending_Qty: number;
  Process_Status: string;
};

type OrderFormState = {
  orderDate: string; customerName: string; productName: string; partNumber: string;
  orderQuantity: string; materialSpecification: string; deliveryDate: string;
  priority: string; remarks: string;
};
function formatDateForSheet(value: string): string {
  const match = value.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}
function displayOrderDate(value: string): string {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const dmy = raw.match(/^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})$/);
  if (dmy) return `${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}-${dmy[3]}`;
  return raw || '—';
}
async function fetchBackendOrders(): Promise<OrderRecord[]> {
  const response = await fetch(`${API_URL}?action=orders`, { method: 'GET', redirect: 'follow' });
  const result = await response.json();
  if (!response.ok || result.success !== true || !Array.isArray(result.orders)) {
    throw new Error(result.error || 'Unable to load orders');
  }
  return result.orders as OrderRecord[];
}

async function fetchBackendProcessJourney(): Promise<ProcessJourneyRecord[]> {
  const response = await fetch(`${API_URL}?action=processJourney`, { method: 'GET', redirect: 'follow' });
  const result = await response.json();
  if (!response.ok || result.success !== true || !Array.isArray(result.journeys)) {
    throw new Error(result.error || result.message || 'Unable to load production plans');
  }
  return result.journeys as ProcessJourneyRecord[];
}

async function fetchBackendEntries(): Promise<Entry[]> {

  const url = `${API_URL}?action=records`

  const response = await fetch(url, { method: 'GET', redirect: 'follow' })

  const responseText = await response.text()

  let result: Record<string, unknown>

  try {

    const parsed: unknown = JSON.parse(responseText)

    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response')

    result = parsed as Record<string, unknown>

  } catch {

    throw new Error(`GET ${url} returned HTTP ${response.status}: ${responseText.trim() || 'unreadable response'}`)

  }

  if (!response.ok || result.success !== true || !Array.isArray(result.records)) {

    const backendError = result.error ?? result.message

    const detail = typeof backendError === 'string' && backendError.trim() ? `: ${backendError}` : ''

    throw new Error(`GET ${url} failed with HTTP ${response.status}${detail}`)

  }



  return result.records.map((row: Record<string, unknown>) => {

    const actual = Number(row.Actual_Qty ?? 0)

    const rejected = Number(row.Rejected_Qty ?? 0)

    const remark = String(row.Remarks ?? '')

    const reason = String(row.Rejection_Reason ?? row.RejectionReason ?? remark)

    return {

      recordId: String(row.Record_ID ?? '').trim() || undefined,

      date: normalizeSheetDate(row.Production_Date),

      shift: String(row.Shift ?? ''),

      machine: String(row.Machine_ID ?? ''),

      product: String(row.Product_Part ?? ''),

      target: Number(row.Target_Qty ?? 0),

      actual,

      good: Number(row.Good_Qty ?? Math.max(0, actual - rejected)),

      rejected,

      reason: String(row.Reason ?? remark),

      remarks: remark,

      shortfallReason: String(row.Shortfall_Reason ?? row.ShortfallReason ?? ''),

      rejectionReason: rejected > 0 ? reason : '',

    }

  })

}



const demoAccounts = [{ role: 'Supervisor' as const, email: 'supervisor@kg.com', password: '1234' }, { role: 'Manager' as const, email: 'manager@kg.com', password: '1234' }]



const initialEntries: Entry[] = []



const entriesStorageKey = 'kinetic-gears-production-entries'



const machinesStorageKey = 'kinetic-gears-machines'



const targetsStorageKey = 'kinetic-gears-machine-targets'



const demoSeededStorageKey = 'kinetic-gears-demo-seed-v1'



const demoMachines: Machine[] = [



  { id: 'MCH-001', name: 'CNC Turning Machine 01', type: 'CNC Turning', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-002', name: 'CNC Turning Machine 02', type: 'CNC Turning', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-003', name: 'CNC Gear Hobbing Machine 01', type: 'Gear Hobbing', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-004', name: 'CNC Gear Hobbing Machine 02', type: 'Gear Hobbing', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-005', name: 'Gear Shaping Machine 01', type: 'Gear Shaping', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-006', name: 'Gear Grinding Machine 01', type: 'Gear Grinding', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-007', name: 'VMC Machine 01', type: 'Machining', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-008', name: 'Drilling Machine 01', type: 'Drilling', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-009', name: 'Induction Hardening Machine 01', type: 'Heat Treatment', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-010', name: 'Gear Inspection Station 01', type: 'Quality Inspection', status: 'Active', remarks: 'Demo sample machine' },



]



const demoDailyTargets = [250, 220, 180, 180, 200, 150, 160, 300, 240, 400]

async function fetchBackendProblems(): Promise<ProblemLogEntry[]> {
  const response = await fetch(`${API_URL}?action=problemLog`, {
    method: 'GET',
    redirect: 'follow',
  });

  const result = await response.json();

  if (!response.ok || result.success !== true || !Array.isArray(result.problems)) {
    throw new Error(result.error || 'Unable to load Problem Log');
  }

  return result.problems;
}





function todayDate() {



  const now = new Date()



  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`



}



function normalizeSheetDate(value: unknown): string {

  const raw = String(value ?? '').trim()

  if (!raw) return ''

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)

  if (match) {

    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`

  }

  return raw

}









function loadStored<T>(key: string): T[] {



  try {



    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')



    return Array.isArray(value) ? value as T[] : []



  } catch { return [] }



}



async function fetchBackendMachines(): Promise<Machine[]> {

  const response = await fetch(`${API_URL}?action=machines`, { method: 'GET', redirect: 'follow' })

  const responseBody = await response.text()

  let result: Record<string, unknown>

  try {

    const parsed: unknown = JSON.parse(responseBody)

    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response')

    result = parsed as Record<string, unknown>

  } catch {

    throw new Error(responseBody.trim() || `Server returned HTTP ${response.status} without an error message.`)

  }

  if (!response.ok || result.success !== true || !Array.isArray(result.machines)) {

    const backendError = result.error ?? result.errorMessage ?? result.message

    throw new Error(typeof backendError === 'string' && backendError.trim() ? backendError : `Server returned HTTP ${response.status} with an invalid machine list.`)

  }



  const records: Machine[] = result.machines.map((row: Record<string, unknown>) => {

    const statusValue = String(row.Active_Status ?? 'Inactive').trim()

    const status: Machine['status'] = statusValue === 'Active' || statusValue === 'Maintenance' ? statusValue : 'Inactive'

    return { id: String(row.Machine_ID ?? '').trim(), name: String(row.Machine_Name ?? '').trim(), type: String(row.Department ?? '').trim(), status, remarks: String(row.Remarks ?? '').trim() }

  }).filter((machine: Machine) => machine.id && machine.name)



  return records.filter((machine, index) => records.findIndex((record) => record.id.toLowerCase() === machine.id.toLowerCase()) === index)

}







function seedDemoData() {



  try {



    if (window.localStorage.getItem(demoSeededStorageKey) === 'true') return



    const machines = loadStored<Machine>(machinesStorageKey)



    const targets = loadStored<MachineTarget>(targetsStorageKey)



    const seededMachines = [...machines, ...demoMachines.filter((sample) => !machines.some((machine) => machine.id.toLowerCase() === sample.id.toLowerCase()))]



    const date = todayDate()



    const seededTargets = [...targets, ...demoMachines.flatMap((machine, index) => targets.some((target) => target.machineId === machine.id && target.date === date) ? [] : [{ id: `demo-${machine.id}-${date}`, date, machineId: machine.id, quantity: demoDailyTargets[index], unit: 'Nos' }])]



    window.localStorage.setItem(machinesStorageKey, JSON.stringify(seededMachines))



    window.localStorage.setItem(targetsStorageKey, JSON.stringify(seededTargets))



    window.localStorage.setItem(demoSeededStorageKey, 'true')



  } catch {



    // Continue with the records available in memory if browser storage is unavailable.



  }



}







seedDemoData()







function loadEntries(): Entry[] {



  try {



    const savedEntries = window.localStorage.getItem(entriesStorageKey)



    if (!savedEntries) return initialEntries



    const parsedEntries: unknown = JSON.parse(savedEntries)



    return Array.isArray(parsedEntries) ? parsedEntries as Entry[] : initialEntries



  } catch {



    return initialEntries



  }



}



const icon = (name: string) => {



  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }



  const paths: Record<string, React.ReactNode> = {



    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>, lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></>, arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>, grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>, factory: <><path d="M3 21V9l6 3V8l6 4V5h6v16Z"/><path d="M7 17h2m3 0h2m3 0h2"/></>, check: <><path d="m5 12 4 4L19 6"/></>, chart: <><path d="M3 3v18h18M8 16v-4m5 4V7m5 9v-7"/></>, logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>, gear: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.2.9-1.3 2.3-1.4-.6a8 8 0 0 1-1.5.9l-.2 1.5h-2.7l-.2-1.5a8 8 0 0 1-1.5-.9l-1.4.6-1.3-2.3 1.2-.9a7 7 0 0 1 0-1.8l-1.2-.9 1.3-2.3 1.4.6a8 8 0 0 1 1.5-.9l.2-1.5h2.7l.2 1.5a8 8 0 0 1 1.5.9l1.4-.6 1.3 2.3-1.2.9a7 7 0 0 1 0 1.8Z"/></>, eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>, eyeoff: <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.3 3.5-.7"/></>, production: <><path d="M4 19V9l5 3V8l5 4V5h6v14Z"/><path d="M8 16h.01M12 16h.01M16 16h.01"/></>, quality: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>, performance: <><path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/></> }



  return <svg {...common}>{paths[name] ?? paths.gear}</svg>



}







type SupervisorHomeJourney = {
  journeyId: string; orderId: string; partNumber: string; machineId: string; processName: string;
  sequence: number; plannedQty: number; completedQty: number; pendingQty: number; status: string; assignedSupervisorEmail: string;
};

// Supervisor workspace: assigned process plans and daily production submission.
function SupervisorHomeProductionTracking({ supervisorEmail }: { supervisorEmail: string }) {
  const [journeys, setJourneys] = useState<SupervisorHomeJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    productionDate: todayDate(), journeyId: '', operatorId: '', shift: 'Day', actualQty: '',
    goodQty: '', rejectedQty: '', reworkQty: '0',
    downtimeMinutes: '0', machineStatus: 'Running',
  });
  const normalizedEmail = supervisorEmail.trim().toLowerCase();
  const selectedJourney = journeys.find(j => j.journeyId === form.journeyId) || null;

  const loadAssignedJourneys = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_URL}?action=machineProcessJourney`, { method: 'GET', redirect: 'follow' });
      const body = await response.text();
      const result = JSON.parse(body) as { success?: boolean; journeys?: Record<string, unknown>[]; error?: string; message?: string };
      if (!response.ok || result.success !== true || !Array.isArray(result.journeys)) {
        throw new Error(result.message || result.error || `Unable to load assigned processes (HTTP ${response.status}).`);
      }
      const all: SupervisorHomeJourney[] = result.journeys.map(row => ({
        journeyId: String(row.Machine_Process_Journey_ID ?? row.journeyId ?? ''),
        orderId: String(row.Order_ID ?? row.orderId ?? ''),
        partNumber: String(row.Part_Number ?? row.partNumber ?? ''),
        machineId: String(row.Machine_ID ?? row.machineId ?? ''),
        processName: String(row.Process_Name ?? row.processName ?? ''),
        sequence: Number(row.Process_Sequence ?? row.sequence ?? 1),
        plannedQty: Number(row.Planned_Qty ?? row.plannedQty ?? 0),
        completedQty: Number(row.Completed_Qty ?? row.completedQty ?? 0),
        pendingQty: Number(row.Pending_Qty ?? row.pendingQty ?? 0),
        status: String(row.Process_Status ?? row.status ?? 'Planned'),
        assignedSupervisorEmail: String(row.Assigned_Supervisor_Email ?? row.assignedSupervisorEmail ?? '').trim().toLowerCase(),
      })).filter(j => j.journeyId);
      const assigned = all.filter(j => j.assignedSupervisorEmail === normalizedEmail);
      setJourneys(assigned);
      setForm(current => ({
        ...current,
        journeyId: assigned.some(j => j.journeyId === current.journeyId) ? current.journeyId : (assigned[0]?.journeyId || ''),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load assigned processes.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadAssignedJourneys(); }, [normalizedEmail]);

  const saveDailyTracking = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedJourney) { setError('Select an assigned process.'); return; }
    const actual = Number(form.actualQty);
    const good = Number(form.goodQty);
    const rejected = Number(form.rejectedQty);
    const rework = Number(form.reworkQty || 0);
    const downtime = Number(form.downtimeMinutes || 0);
    if (!Number.isFinite(actual) || actual <= 0) { setError('Actual quantity must be greater than zero.'); return; }
    if (![good, rejected, rework, downtime].every(v => Number.isFinite(v) && v >= 0)) { setError('Good, rejected, rework and downtime values must be non-negative numbers.'); return; }
    if (good + rejected !== actual) { setError('Good quantity + Rejected quantity must equal Actual quantity.'); return; }
    if (actual > selectedJourney.pendingQty) { setError(`Actual quantity cannot exceed remaining pending quantity (${selectedJourney.pendingQty}).`); return; }

    setSavingId(selectedJourney.journeyId); setError(''); setMessage('');
    try {
      const payload = {
        action: 'saveMachineProcessTracking',
        Machine_Process_Journey_ID: selectedJourney.journeyId,
        Supervisor_Email: normalizedEmail,
        Production_Date: form.productionDate,
        Shift: form.shift,
        Operator_ID: form.operatorId.trim(),
        Actual_Qty: actual,
        Good_Qty: good,
        Rejected_Qty: rejected,
        Rework_Qty: rework,
        Downtime_Minutes: downtime,
        Machine_Status: form.machineStatus,
      };
      const response = await fetch(API_URL, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const body = await response.text();
      let result: Record<string, unknown>;
      try { result = JSON.parse(body) as Record<string, unknown>; }
      catch { throw new Error(`Daily tracking returned unreadable data: ${body.trim() || `HTTP ${response.status}`}`); }
      if (!response.ok || result.success !== true) throw new Error(String(result.message || result.error || 'Daily tracking could not be saved.'));
      setMessage(`Daily production saved. Tracking ID: ${String(result.trackingId || '')}. Pending quantity: ${String(result.pendingQty ?? '')}.`);
      setForm(current => ({ ...current, actualQty: '', goodQty: '', rejectedQty: '', reworkQty: '0', downtimeMinutes: '0' }));
      await loadAssignedJourneys();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save daily production.');
    } finally { setSavingId(null); }
  };

  return (
    <section className="surface records-surface" id="entry">
      <div className="section-heading">
        <div><span className="section-index">03</span><div><h2>Assigned Processes & Daily Production</h2><p>Process plans assigned to {normalizedEmail || 'this Supervisor'}</p></div></div>
        <button className="secondary-button" type="button" onClick={() => void loadAssignedJourneys()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {message && <p className="form-message" role="status">{message}</p>}
      {error && <p className="form-message" role="alert">{error}</p>}
      {loading ? <div className="empty-state">Loading your assigned processes…</div> : journeys.length === 0 ? <div className="empty-state">No process plans have been assigned to your email yet.</div> : (
        <>
          <div className="table-wrap"><table><thead><tr><th>Journey ID</th><th>Order ID</th><th>Part</th><th>Machine</th><th>Process</th><th>Sequence</th><th>Planned</th><th>Completed</th><th>Pending</th><th>Status</th></tr></thead>
            <tbody>{journeys.map(j => <tr key={j.journeyId}><td>{j.journeyId}</td><td>{j.orderId}</td><td>{j.partNumber}</td><td>{j.machineId}</td><td>{j.processName}</td><td>{j.sequence}</td><td>{j.plannedQty}</td><td>{j.completedQty}</td><td>{j.pendingQty}</td><td>{j.status}</td></tr>)}</tbody>
          </table></div>
          <section className="surface manager-config-card" style={{ marginTop: 20 }}>
            <div className="section-heading"><div><span className="section-index">04</span><div><h2>Production Entry & Assigned Process Tracking</h2><p>View your assigned process and submit daily production in one place. The backend updates cumulative completed and pending quantities.</p></div></div></div>
            <form className="entry-form" onSubmit={saveDailyTracking}>
              <div className="form-grid">
                <Field label="Production Date"><input type="date" value={form.productionDate} onChange={e => setForm({ ...form, productionDate: e.target.value })} required /></Field>
                <Field label="Order ID"><input value={selectedJourney?.orderId || ''} readOnly placeholder="Select assigned process" /></Field>
                <Field label="Part Number"><input value={selectedJourney?.partNumber || ''} readOnly placeholder="Auto-filled from assigned process" /></Field>
                <Field label="Machine"><input value={selectedJourney?.machineId || ''} readOnly placeholder="Auto-filled from assigned process" /></Field>
                <Field label="Assigned Process"><select value={form.journeyId} onChange={e => setForm({ ...form, journeyId: e.target.value })} required>
                  <option value="">Select assigned process</option>
                  {journeys.map(j => <option key={j.journeyId} value={j.journeyId}>{j.journeyId} · {j.orderId} · Seq {j.sequence} · {j.processName} (Pending: {j.pendingQty})</option>)}
                </select></Field>
                <Field label="Shift"><select value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}><option>Day</option><option>Night</option><option>General</option><option>A</option><option>B</option><option>C</option></select></Field>
                <Field label="Operator ID"><input value={form.operatorId} onChange={e => setForm({ ...form, operatorId: e.target.value })} placeholder="Optional operator ID" /></Field>
                <Field label="Actual Quantity"><input type="number" min="1" step="1" value={form.actualQty} onChange={e => setForm({ ...form, actualQty: e.target.value })} required /></Field>
                <Field label="Good Quantity"><input type="number" min="0" step="1" value={form.goodQty} onChange={e => setForm({ ...form, goodQty: e.target.value })} required /></Field>
                <Field label="Rejected Quantity"><input type="number" min="0" step="1" value={form.rejectedQty} onChange={e => setForm({ ...form, rejectedQty: e.target.value })} required /></Field>
                <Field label="Rework Quantity"><input type="number" min="0" step="1" value={form.reworkQty} onChange={e => setForm({ ...form, reworkQty: e.target.value })} /></Field>
                <Field label="Downtime (Minutes)"><input type="number" min="0" step="1" value={form.downtimeMinutes} onChange={e => setForm({ ...form, downtimeMinutes: e.target.value })} /></Field>
                <Field label="Machine Status"><select value={form.machineStatus} onChange={e => setForm({ ...form, machineStatus: e.target.value })}><option>Running</option><option>Idle</option><option>Breakdown</option><option>Maintenance</option></select></Field>
              </div>
              {selectedJourney && <p className="form-message">Selected process: {selectedJourney.processName} · Remaining quantity: {selectedJourney.pendingQty}</p>}
              <div className="form-actions"><span>{error}</span><button className="primary-button save-button" type="submit" disabled={savingId !== null || !selectedJourney || selectedJourney.pendingQty <= 0}>{savingId ? 'Saving…' : 'Submit Daily Production'}</button></div>
            </form>
          </section>
        </>
      )}
    </section>
  );
}



type CapacityProcessInput = {
  journeyId: string;
  sequence: number;
  processName: string;
  includedInOrder: boolean;
  machineId: string;
  cycleTimeSeconds: string;
  machineCount: string;
};

type CapacityPlanRecord = {
  id: string;
  orderId: string;
  productName: string;
  partNumber: string;
  orderQuantity: number;
  deliveryDate: string;
  shiftCount: number;
  hoursPerShift: number;
  breakMinutesPerShift: number;
  workingDays: number;
  availableWorkingDays: number;
  efficiencyPct: number;
  batchSize: number;
  batchCount: number;
  processes: Array<{
    journeyId: string; sequence: number; processName: string; machineId: string;
    cycleTimeSeconds: number; machineCount: number; requiredMachineMinutes: number;
    dailyCapacity: number; availableMinutesPerMachine: number; idleMinutesPerMachine: number;
    machinesRequired: number; requiredDailyQty: number; requiredShiftQty: number;
    totalMachineHours: number; availableMachineHours: number; utilizationPct: number; idleHours: number; machineFeasible: boolean;
  }>;
  bottleneckProcess: string;
  dailyCapacity: number;
  estimatedDays: number;
  requiredByDate: boolean;
  status: 'Pending Approval' | 'Approved' | 'Rejected';
  supervisorEmail: string;
  submittedAt: string;
  managerComment: string;
};

const phase3StorageKey = 'production-monitoring-phase3-capacity-plans-v1';

function loadCapacityPlans(): CapacityPlanRecord[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(phase3StorageKey) || '[]');
    return Array.isArray(parsed) ? parsed as CapacityPlanRecord[] : [];
  } catch { return []; }
}

function Phase3CapacityWorkspace({
  role, email, orders,
}: {
  role: Role; email: string; orders: OrderRecord[];
}) {
  const [plans, setPlans] = useState<CapacityPlanRecord[]>(loadCapacityPlans);
  const [phase3Machines, setPhase3Machines] = useState<Machine[]>([]);
  const [cycleDefaults, setCycleDefaults] = useState<Record<string, string>>(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(phase3CycleDefaultsStorageKey) || '{}');
      return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
    } catch { return {}; }
  });
  const [routeLoading, setRouteLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [shiftCount, setShiftCount] = useState('2');
  const [hoursPerShift, setHoursPerShift] = useState('8');
  const [breakMinutesPerShift, setBreakMinutesPerShift] = useState('60');
  // Factory calendar confirmed for Phase 3: Monday to Saturday; Sunday is off.
  const workingDays = '6';
  const [efficiencyPct, setEfficiencyPct] = useState('85');
  // Editable planning assumption; change this to match the factory's transfer batch.
  const [batchSize, setBatchSize] = useState('1000');
  const [processInputs, setProcessInputs] = useState<CapacityProcessInput[]>([]);
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Phase 3-only normalizer: tolerate Apps Script header variations without
  // changing the Phase 2 API, data, or screens.
  const normalizePhase3Route = (payload: unknown): SupervisorHomeJourney[] => {
    const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const source = Array.isArray(root.journeys) ? root.journeys
      : Array.isArray(root.records) ? root.records
      : Array.isArray(root.data) ? root.data : [];
    const read = (row: Record<string, unknown>, aliases: string[]) => {
      const entries = Object.entries(row);
      for (const alias of aliases) {
        const found = entries.find(([key]) => key.replace(/[^a-z0-9]/gi, '').toLowerCase() === alias.replace(/[^a-z0-9]/gi, '').toLowerCase());
        if (found && found[1] !== null && found[1] !== undefined && String(found[1]).trim() !== '') return found[1];
      }
      return '';
    };
    return source.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map((row, index) => {
      const orderId = String(read(row, ['Order_ID', 'Order ID', 'Order_Id', 'order_id', 'orderId'])).trim();
      const processName = String(read(row, ['Process_Name', 'Process Name', 'processName'])).trim();
      const machineId = String(read(row, ['Machine_ID', 'Machine ID', 'Machine_Id', 'machine_id', 'machineId'])).trim();
      const sequence = Number(read(row, ['Process_Sequence', 'Process Sequence', 'sequence']) || 1);
      const journeyId = String(read(row, ['Machine_Process_Journey_ID', 'Journey_ID', 'Process_Journey_ID', 'journeyId'])).trim()
        || `P3-${orderId}-${sequence}-${processName}-${machineId}-${index}`;
      return {
        journeyId, orderId,
        partNumber: String(read(row, ['Part_Number', 'Part Number', 'partNumber'])),
        machineId, processName, sequence: Number.isFinite(sequence) ? sequence : 1,
        plannedQty: Number(read(row, ['Planned_Qty', 'Planned Qty', 'plannedQty']) || 0),
        completedQty: Number(read(row, ['Completed_Qty', 'Completed Qty', 'completedQty']) || 0),
        pendingQty: Number(read(row, ['Pending_Qty', 'Pending Qty', 'pendingQty']) || 0),
        status: String(read(row, ['Process_Status', 'Process Status', 'status']) || 'Planned'),
        assignedSupervisorEmail: String(read(row, ['Assigned_Supervisor_Email', 'Assigned Supervisor Email', 'assignedSupervisorEmail'])).trim().toLowerCase(),
      };
    }).filter(row => row.orderId && row.processName);
  };

  const refreshPhase3Route = async () => {
    setRouteLoading(true);
    setError('');
    try {
      // Read the same active Machine Master list used by Production Planning.
      const machineRows = await fetchBackendMachines();
      setPhase3Machines(machineRows.filter(machine => machine.status === 'Active'));
      const response = await fetch(`${API_URL}?action=machineProcessJourney`, { method: 'GET', redirect: 'follow' });
      const body = await response.text();
      let result: Record<string, unknown>;
      try { result = JSON.parse(body) as Record<string, unknown>; }
      catch { throw new Error('Production Planning API returned an unreadable response.'); }
      if (!response.ok || result.success === false) throw new Error(String(result.message || result.error || 'Unable to load Production Planning route.'));
      normalizePhase3Route(result); // Validate response shape; process sequence is fixed in Phase 3.
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Phase 2 process routes.');
    } finally { setRouteLoading(false); }
  };

  useEffect(() => {
    try { window.localStorage.setItem(phase3StorageKey, JSON.stringify(plans)); }
    catch { setError('Unable to save Phase 3 records in this browser.'); }
  }, [plans]);

  const selectedOrder = orders.find(order => String(order['Order ID'] || '').trim() === selectedOrderId) || null;
  // Phase 3 keeps the process sequence fixed. Machine choices are loaded
  // dynamically from the active Machine Master list used by Production Planning.
  useEffect(() => { void refreshPhase3Route(); }, []);

  useEffect(() => {
    if (!selectedOrderId) { setProcessInputs([]); return; }
    setProcessInputs(PHASE3_PROCESS_DEFAULTS.map(item => ({
      journeyId: `P3-${selectedOrderId}-${item.sequence}`,
      sequence: item.sequence,
      processName: item.processName,
      includedInOrder: false,
      machineId: '',
      cycleTimeSeconds: '',
      machineCount: '1',
    })));
  }, [selectedOrderId]);

  useEffect(() => {
    try { window.localStorage.setItem(phase3CycleDefaultsStorageKey, JSON.stringify(cycleDefaults)); }
    catch { setError('Unable to save Phase 3 cycle-time defaults in this browser.'); }
  }, [cycleDefaults]);

  const getCycleKey = (processName: string, machineId: string) =>
    `${processName.trim().toLowerCase()}::${machineId.trim().toLowerCase()}`;

  const updateProcessMachine = (index: number, machineId: string) => {
    const row = processInputs[index];
    if (!row) return;
    const key = getCycleKey(row.processName, machineId);
    const processDefault = PHASE3_PROCESS_DEFAULTS.find(item => item.processName === row.processName)?.defaultCycleSeconds || '60';
    const cycleTimeSeconds = machineId ? (cycleDefaults[key] || processDefault) : '';
    setProcessInputs(current => current.map((item, i) => i === index
      ? { ...item, machineId, cycleTimeSeconds, machineCount: machineId ? '1' : '0', includedInOrder: Boolean(machineId) }
      : item));
  };

  const updateProcessCycleTime = (index: number, value: string) => {
    const row = processInputs[index];
    if (!row) return;
    setProcessInputs(current => current.map((item, i) => i === index ? { ...item, cycleTimeSeconds: value } : item));
    if (row.machineId) setCycleDefaults(current => ({ ...current, [getCycleKey(row.processName, row.machineId)]: value }));
  };

  const calculations = useMemo(() => {
    const shifts = Number(shiftCount), hours = Number(hoursPerShift), days = Number(workingDays);
    const breakMinutes = Number(breakMinutesPerShift);
    const efficiency = Number(efficiencyPct), transferBatchSize = Number(batchSize);
    if (!selectedOrder || !processInputs.length ||
        ![shifts, hours, days, breakMinutes, efficiency, transferBatchSize].every(Number.isFinite) ||
        shifts <= 0 || hours <= 0 || days <= 0 || breakMinutes < 0 || breakMinutes >= hours * 60 ||
        efficiency <= 0 || efficiency > 100 || !Number.isInteger(transferBatchSize) || transferBatchSize <= 0) return null;

    const quantity = Number(selectedOrder['Order Quantity']);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;

    const delivery = selectedOrder['Delivery Date'];
    const normalizedDeliveryDate = normalizeSheetDate(delivery);
    // Parse YYYY-MM-DD as a local calendar date to avoid UTC/time-zone shifts.
    const deliveryParts = normalizedDeliveryDate.split('-').map(Number);
    const deliveryDate = deliveryParts.length === 3 && deliveryParts.every(Number.isFinite)
      ? new Date(deliveryParts[0], deliveryParts[1] - 1, deliveryParts[2])
      : new Date(Number.NaN);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isNaN(deliveryDate.getTime()) || deliveryDate < today) return null;

    // Count actual calendar dates inclusively. Monday-Saturday are working days;
    // Sunday is off. Factory/public holidays are not excluded because no holiday
    // calendar is configured in this POC yet.
    let availableWorkingDays = 0;
    const cursor = new Date(today);
    while (cursor <= deliveryDate) {
      if (cursor.getDay() !== 0) availableWorkingDays += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    if (availableWorkingDays <= 0) return null;
    const planningDays = availableWorkingDays;
    const requiredDailyQty = Math.ceil(quantity / planningDays);
    const requiredShiftQty = Math.ceil(requiredDailyQty / shifts);

    const netMinutesPerShift = hours * 60 - breakMinutes;
    const dailyAvailableMinutesPerMachine = shifts * netMinutesPerShift * efficiency / 100;
    const includedInputs = processInputs.filter(input => input.includedInOrder);
    if (!includedInputs.length) return null;
    const rows = includedInputs.map(input => {
      const cycle = Number(input.cycleTimeSeconds), count = Number(input.machineCount);
      if (!input.processName.trim() || !input.machineId.trim() || !Number.isFinite(cycle) || cycle <= 0 ||
          !Number.isInteger(count) || count <= 0) return null;
      // Step 1: net production time after breaks and expected efficiency.
      // Step 2: size the machine pool against the required DAILY output.
      const requiredMachineMinutes = quantity * cycle / 60;
      const availableMinutesPerMachine = dailyAvailableMinutesPerMachine * planningDays;
      const perMachineDailyCapacity = dailyAvailableMinutesPerMachine / (cycle / 60);
      const dailyCapacity = Math.floor(perMachineDailyCapacity * count);
      const machinesRequired = Math.max(1, Math.ceil(requiredDailyQty / Math.max(perMachineDailyCapacity, 0.000001)));
      const totalMachineHours = requiredMachineMinutes / 60;
      const availableMachineHours = count * availableMinutesPerMachine / 60;
      const utilizationPct = availableMachineHours > 0 ? Math.min(100, totalMachineHours / availableMachineHours * 100) : 0;
      const idleHours = Math.max(0, availableMachineHours - totalMachineHours);
      return {
        ...input, cycleTimeSeconds: cycle, machineCount: count, requiredMachineMinutes,
        dailyCapacity, availableMinutesPerMachine, idleMinutesPerMachine: idleHours * 60 / count,
        machinesRequired, requiredDailyQty, requiredShiftQty, totalMachineHours,
        availableMachineHours, utilizationPct, idleHours, machineFeasible: machinesRequired <= count,
      };
    });
    if (rows.some(row => row === null)) return null;
    const validRows = rows as NonNullable<typeof rows[number]>[];

    // Batch-wise sequential flow estimate; each downstream batch waits for its upstream batch.
    const batchCount = Math.ceil(quantity / transferBatchSize);
    const stageCompletion: number[][] = validRows.map(() => Array(batchCount).fill(0));
    validRows.forEach((row, processIndex) => {
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const batchQty = Math.min(transferBatchSize, quantity - batchIndex * transferBatchSize);
        const batchProcessingMinutes = (batchQty * row.cycleTimeSeconds / 60) / row.machineCount;
        const previousProcessCompletion = processIndex > 0 ? stageCompletion[processIndex - 1][batchIndex] : 0;
        const previousBatchCompletion = batchIndex > 0 ? stageCompletion[processIndex][batchIndex - 1] : 0;
        stageCompletion[processIndex][batchIndex] = Math.max(previousProcessCompletion, previousBatchCompletion) + batchProcessingMinutes;
      }
    });

    const bottleneck = validRows.reduce((min, row) => row.dailyCapacity < min.dailyCapacity ? row : min, validRows[0]);
    const dailyCapacity = Math.min(...validRows.map(row => row.dailyCapacity));
    // Delivery estimate is governed by the slowest process (the line bottleneck).
    // Batch-flow minutes remain available as a planning reference, not as the delivery decision.
    const batchFlowMinutes = stageCompletion[validRows.length - 1][batchCount - 1];
    const pipelineWorkingDays = dailyCapacity > 0 ? quantity / dailyCapacity : Infinity;
    const estimatedDays = Math.ceil(pipelineWorkingDays);
    const machineFeasible = validRows.every(row => row.machineFeasible && row.dailyCapacity >= requiredDailyQty);
    const requiredByDate = availableWorkingDays > 0 && machineFeasible && pipelineWorkingDays <= availableWorkingDays;

    return {
      rows: validRows, quantity, batchSize: transferBatchSize, batchCount,
      bottleneckProcess: bottleneck.processName, dailyCapacity,
      requiredDailyQty, requiredShiftQty, estimatedDays, pipelineWorkingDays, batchFlowMinutes,
      availableWorkingDays, machineFeasible, requiredByDate,
      totalMachineHours: validRows.reduce((sum, row) => sum + row.totalMachineHours, 0),
      totalAvailableMachineHours: validRows.reduce((sum, row) => sum + row.availableMachineHours, 0),
      totalIdleHours: validRows.reduce((sum, row) => sum + row.idleHours, 0),
    };
  }, [selectedOrder, processInputs, shiftCount, hoursPerShift, breakMinutesPerShift, workingDays, efficiencyPct, batchSize]);

  async function submitCalculation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (role !== 'Supervisor') return;
    if (!selectedOrder) { setError('Select a registered order.'); return; }
    if (!processInputs.length) { setError('Add at least one process to calculate capacity.'); return; }
    if (!calculations) { setError('Enter a valid cycle time for every Production Planning process and check the shift settings.'); return; }

    setSaving(true);

    const record: CapacityPlanRecord = {
      id: `CAP-${Date.now()}`,
      orderId: selectedOrderId,
      productName: selectedOrder['Product Name'],
      partNumber: selectedOrder['Part Number'],
      orderQuantity: calculations.quantity,
      deliveryDate: normalizeSheetDate(selectedOrder['Delivery Date']),
      shiftCount: Number(shiftCount),
      hoursPerShift: Number(hoursPerShift),
      breakMinutesPerShift: Number(breakMinutesPerShift),
      workingDays: Number(workingDays),
      availableWorkingDays: calculations.availableWorkingDays,
      efficiencyPct: Number(efficiencyPct),
      batchSize: calculations.batchSize,
      batchCount: calculations.batchCount,
      processes: calculations.rows,
      bottleneckProcess: calculations.bottleneckProcess,
      dailyCapacity: calculations.dailyCapacity,
      estimatedDays: calculations.estimatedDays,
      requiredByDate: calculations.requiredByDate,
      status: 'Pending Approval',
      supervisorEmail: email,
      submittedAt: new Date().toISOString(),
      managerComment: '',
    };

    const payload = {
      id: record.id,
      orderId: record.orderId,
      orderQuantity: record.orderQuantity,
      deliveryDate: record.deliveryDate,
      workingDays: record.workingDays,
      availableWorkingDays: record.availableWorkingDays,
      shiftCount: record.shiftCount,
      hoursPerShift: record.hoursPerShift,
      breakMinutesPerShift: record.breakMinutesPerShift,
      efficiencyPct: record.efficiencyPct,
      batchSize: record.batchSize,
      requiredDailyQty: calculations.requiredDailyQty,
      requiredShiftQty: calculations.requiredShiftQty,
      bottleneckProcess: record.bottleneckProcess,
      dailyCapacity: record.dailyCapacity,
      estimatedDays: record.estimatedDays,
      requiredByDate: record.requiredByDate,
      totalMachineHours: calculations.totalMachineHours,
      totalAvailableMachineHours: calculations.totalAvailableMachineHours,
      totalIdleHours: calculations.totalIdleHours,
      supervisorEmail: record.supervisorEmail,
      submittedAt: record.submittedAt,
      processes: record.processes,
    };

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveCapacityPlan', data: payload }),
      });

      const responseText = await response.text();
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        throw new Error(`Capacity calculation returned unreadable data: ${responseText.trim() || `HTTP ${response.status}`}`);
      }

      if (!response.ok || result.success !== true) {
        throw new Error(String(result.message || result.error || 'Unable to save capacity calculation.'));
      }

      setPlans(current => [record, ...current]);
      setMessage(`Calculation ${record.id} saved in Google Sheets and submitted for Manager approval.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save capacity calculation.');
    } finally {
      setSaving(false);
    }
  }

  function reviewPlan(planId: string, status: 'Approved' | 'Rejected') {
    const comment = reviewComments[planId] || '';
    if (status === 'Rejected' && !comment.trim()) { setError('Please add a comment before rejecting a calculation.'); return; }
    setError(''); setMessage('');
    setPlans(current => current.map(plan => plan.id === planId ? { ...plan, status, managerComment: comment.trim() } : plan));
    setMessage(`${planId} ${status.toLowerCase()} successfully.`);
  }

  const pendingPlans = plans.filter(plan => plan.status === 'Pending Approval');
  const visiblePlans = role === 'Manager' ? plans : plans.filter(plan => plan.supervisorEmail.toLowerCase() === email.toLowerCase());

  return <div className="phase3-capacity-workspace">
    <section className="surface records-surface">
      <div className="section-heading"><div><span className="section-index">PHASE 03</span><div><h2>{role === 'Supervisor' ? 'Capacity Calculation' : 'Capacity Plan Approval'}</h2><p>{role === 'Supervisor' ? 'Calculate machine capacity using the sequential process route and submit it for approval.' : 'Review calculations submitted by Supervisors. Approve or reject each production capacity plan.'}</p></div></div><span className="draft-label">{role === 'Supervisor' ? 'SUPERVISOR WORKSPACE' : `${pendingPlans.length} PENDING`}</span></div>
      {message && <p className="form-message" role="status">{message}</p>}
      {error && <p className="form-message" role="alert">{error}</p>}
      {role === 'Supervisor' ? <form className="entry-form" onSubmit={submitCalculation}>
        <div className="form-grid">
          <Field label="Registered Order"><select value={selectedOrderId} onChange={event => setSelectedOrderId(event.target.value)} required><option value="">Select order</option>{orders.map((order, index) => <option key={`${order['Order ID']}-${index}`} value={order['Order ID']}>{order['Order ID']} — {order['Product Name'] || order['Part Number'] || 'Order'}</option>)}</select></Field>
          <Field label="Order Quantity"><input value={selectedOrder?.['Order Quantity'] || ''} readOnly placeholder="Auto-filled from order" /></Field>
          <Field label="Delivery Date"><input value={selectedOrder ? displayOrderDate(selectedOrder['Delivery Date']) : ''} readOnly placeholder="Auto-filled from order" /></Field>
          <Field label="Shifts per Day"><input type="number" min="1" max="4" value={shiftCount} onChange={event => setShiftCount(event.target.value)} required /></Field>
          <Field label="Hours per Shift"><input type="number" min="1" max="24" step="0.5" value={hoursPerShift} onChange={event => setHoursPerShift(event.target.value)} required /></Field>
          <Field label="Break Time per Shift (minutes)"><input type="number" min="0" max="1439" step="1" value={breakMinutesPerShift} onChange={event => setBreakMinutesPerShift(event.target.value)} required /><small>Total lunch and normal break time for one shift.</small></Field>
          <Field label="Factory Working Schedule"><input value="Monday to Saturday (Sunday off)" readOnly /><small>Working days are counted from the actual calendar dates. Factory holidays are not excluded yet.</small></Field>
          <Field label="Expected Efficiency (%)"><input type="number" min="1" max="100" value={efficiencyPct} onChange={event => setEfficiencyPct(event.target.value)} required /></Field>
          <Field label="Transfer Batch Size (editable)"><input type="number" min="1" step="1" value={batchSize} onChange={event => setBatchSize(event.target.value)} required /><small>Initial planning assumption: 1,000 pieces per batch. Set the actual factory batch size.</small></Field>
        </div>
        <div className="section-heading" style={{ marginTop: 24 }}><div><span className="section-index">01</span><div><h2>Sequential Machine Route</h2><p>Cycle time and machine count are entered for each process in sequence.</p></div></div></div>
        {routeLoading ? <div className="empty-state">Loading Production Planning process and machine assignments…</div> : <><div className="table-wrap"><table><thead><tr><th>Sequence</th><th>Include in Order?</th><th>Process</th><th>Machine (select from active Machine Master)</th><th>Cycle Time (sec / piece)</th><th>Selected Machines</th></tr></thead><tbody>{processInputs.map((input, index) => <tr key={input.journeyId}><td>{input.sequence}</td><td><label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><input type="checkbox" aria-label={`Include ${input.processName} in order`} checked={input.includedInOrder} onChange={event => setProcessInputs(current => current.map((item, i) => i === index ? { ...item, includedInOrder: event.target.checked } : item))} /><span>Required</span></label></td><td><input aria-label={`Process name ${index + 1}`} value={input.processName} readOnly /></td><td><select aria-label={`Machine for ${input.processName}`} value={input.machineId} onChange={event => updateProcessMachine(index, event.target.value)}><option value="">Select active machine</option>{phase3Machines.map(machine => <option key={machine.id} value={machine.id}>{machine.id} — {machine.name}</option>)}</select></td><td><input aria-label={`Cycle time for ${input.processName || `process ${index + 1}`}`} type="number" min="0.01" step="0.01" value={input.cycleTimeSeconds} onChange={event => updateProcessCycleTime(index, event.target.value)} placeholder="Select machine first" disabled={!input.machineId} /></td><td><input aria-label={`Selected machine count for ${input.processName}`} type="number" value={input.machineCount} readOnly /></td></tr>)}</tbody></table></div><div className="form-actions"><span>{phase3Machines.length ? 'Select Required for each process included in this order. Unchecked processes are skipped from capacity and delivery calculations. Choose an active machine for each required process.' : 'No active machines were loaded from Machine Master. Check Production Planning machine dropdown and click Refresh Route.'}</span><button type="button" className="secondary-button" onClick={() => void refreshPhase3Route()}>Refresh Route</button></div></>}
        {calculations && <><div className="section-heading" style={{ marginTop: 24 }}><div><span className="section-index">02</span><div><h2>Capacity Calculation Results</h2><p>Order requirement, process capacity, machine loading and delivery feasibility.</p></div></div></div><section className="kpi-grid"><article className="kpi-card"><small>Required Daily Production</small><strong>{calculations.requiredDailyQty.toLocaleString('en-IN')}</strong><span>pieces / day</span></article><article className="kpi-card"><small>Required Per Shift</small><strong>{calculations.requiredShiftQty.toLocaleString('en-IN')}</strong><span>pieces / shift</span></article><article className="kpi-card"><small>Bottleneck Process</small><strong>{calculations.bottleneckProcess}</strong><span>Lowest daily process capacity</span></article><article className="kpi-card"><small>Delivery Feasibility</small><strong>{calculations.requiredByDate ? 'Feasible' : 'Not Feasible / At Risk'}</strong><span>{calculations.estimatedDays} estimated working days · {calculations.availableWorkingDays} available</span></article></section><section className="kpi-grid"><article className="kpi-card"><small>Total Machine Workload</small><strong>{calculations.totalMachineHours.toFixed(2)} hrs</strong><span>Across all listed processes</span></article><article className="kpi-card"><small>Available Machine Time</small><strong>{calculations.totalAvailableMachineHours.toFixed(2)} hrs</strong><span>All machines combined</span></article><article className="kpi-card"><small>Estimated Idle Time</small><strong>{calculations.totalIdleHours.toFixed(2)} hrs</strong><span>Aggregate planning estimate</span></article><article className="kpi-card"><small>Line Daily Capacity</small><strong>{calculations.dailyCapacity.toLocaleString('en-IN')}</strong><span>pieces / day at bottleneck</span></article></section><p className="form-message">Planning basis: {calculations.quantity.toLocaleString('en-IN')} pieces ÷ {Math.max(1, calculations.availableWorkingDays)} available working days. Per-shift target is daily target ÷ {Number(shiftCount)} shifts. Break time and expected efficiency are deducted. Working-day availability is an estimate based on working days per week; holidays, setup time, downtime and maintenance are not included. Idle time is an estimate, not a live machine-state measurement.</p><div className="table-wrap"><table><thead><tr><th>Process</th><th>Cycle Time</th><th>Machines Available</th><th>Daily Target</th><th>Shift Target</th><th>Total Workload (hrs)</th><th>Available Machine Time (hrs)</th><th>Utilization</th><th>Idle / Machine (hrs)</th><th>Machines Required</th><th>Capacity Check</th></tr></thead><tbody>{calculations.rows.map(row => <tr key={row.journeyId}><td>{row.processName}</td><td>{row.cycleTimeSeconds} sec</td><td>{row.machineCount}</td><td>{row.requiredDailyQty.toLocaleString('en-IN')}</td><td>{row.requiredShiftQty.toLocaleString('en-IN')}</td><td>{row.totalMachineHours.toFixed(2)}</td><td>{row.availableMachineHours.toFixed(2)}</td><td>{row.utilizationPct.toFixed(1)}%</td><td>{(row.idleMinutesPerMachine / 60).toFixed(2)}</td><td>{row.machinesRequired}</td><td>{row.machineFeasible && row.dailyCapacity >= row.requiredDailyQty ? 'Sufficient' : 'Insufficient'}</td></tr>)}</tbody></table></div><p className="form-message">Batch plan: {calculations.batchCount.toLocaleString('en-IN')} batches × up to {calculations.batchSize.toLocaleString('en-IN')} pieces. Bottleneck-based completion estimate: {calculations.pipelineWorkingDays.toFixed(2)} working days. Batch-flow processing reference: {(calculations.batchFlowMinutes / 60).toFixed(2)} hours (simplified; excludes setup, transfer delays and downtime). Delivery feasibility uses the bottleneck daily capacity and available working days.</p></>}
        <div className="form-actions"><span>Review the calculated figures before submitting.</span><button className="primary-button save-button" type="submit" disabled={saving || !calculations}>{saving ? 'Submitting…' : 'Submit for Manager Approval'}</button></div>
      </form> : <>
        <div className="kpi-grid"><article className="kpi-card"><small>Pending Approval</small><strong>{pendingPlans.length}</strong><span>Awaiting your review</span></article><article className="kpi-card"><small>Approved</small><strong>{plans.filter(plan => plan.status === 'Approved').length}</strong><span>Approved capacity plans</span></article><article className="kpi-card"><small>Rejected</small><strong>{plans.filter(plan => plan.status === 'Rejected').length}</strong><span>Returned for correction</span></article></div>
      </>}
    </section>
    <section className="surface records-surface">
      <div className="section-heading"><div><span className="section-index">03</span><div><h2>{role === 'Manager' ? 'Submitted Calculations' : 'My Submitted Calculations'}</h2><p>Calculation history and approval status</p></div></div></div>
      {visiblePlans.length === 0 ? <div className="empty-state">{role === 'Manager' ? 'No capacity calculations have been submitted yet.' : 'You have not submitted a capacity calculation yet.'}</div> : visiblePlans.map(plan => <article key={plan.id} style={{ border: '1px solid #dbe3ec', borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}><div><b>{plan.id} · {plan.orderId}</b><div style={{ color: '#64748b', fontSize: 13 }}>{plan.productName} · {plan.partNumber || 'No part number'} · Qty {plan.orderQuantity.toLocaleString('en-IN')}</div><div style={{ color: '#64748b', fontSize: 12 }}>Submitted by {plan.supervisorEmail} · {new Date(plan.submittedAt).toLocaleString('en-IN')}</div></div><span className={`machine-status ${plan.status === 'Approved' ? 'active' : plan.status === 'Rejected' ? 'inactive' : ''}`}>{plan.status}</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 14, fontSize: 13 }}><span>Required daily: <b>{Math.ceil(plan.orderQuantity / Math.max(1, plan.availableWorkingDays || plan.workingDays)).toLocaleString('en-IN')}</b></span><span>Required per shift: <b>{Math.ceil(plan.orderQuantity / Math.max(1, plan.availableWorkingDays || plan.workingDays) / Math.max(1, plan.shiftCount)).toLocaleString('en-IN')}</b></span><span>Daily capacity: <b>{plan.dailyCapacity.toLocaleString('en-IN')}</b></span><span>Bottleneck: <b>{plan.bottleneckProcess}</b></span><span>Estimated days: <b>{plan.estimatedDays}</b></span><span>Batch size: <b>{(plan.batchSize || plan.orderQuantity).toLocaleString('en-IN')}</b></span><span>Batches: <b>{plan.batchCount || 1}</b></span><span>Delivery: <b>{plan.requiredByDate ? 'Feasible' : 'Not Feasible / At Risk'}</b></span></div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Sequence</th><th>Process</th><th>Machine</th><th>Cycle Time</th><th>Machine Count</th><th>Daily Capacity</th></tr></thead><tbody>{plan.processes.map(process => <tr key={process.journeyId}><td>{process.sequence}</td><td>{process.processName}</td><td>{process.machineId}</td><td>{process.cycleTimeSeconds} sec</td><td>{process.machineCount}</td><td>{process.dailyCapacity.toLocaleString('en-IN')}</td></tr>)}</tbody></table></div>
        {plan.managerComment && <p className="form-message">Manager comment: {plan.managerComment}</p>}
        {role === 'Manager' && plan.status === 'Pending Approval' && <div style={{ marginTop: 12 }}><Field label="Review Comment"><textarea value={reviewComments[plan.id] || ''} onChange={event => setReviewComments(current => ({ ...current, [plan.id]: event.target.value }))} placeholder="Add approval note or rejection reason" /></Field><div className="form-actions"><span>Approval records the decision for this submitted plan.</span><div style={{ display: 'flex', gap: 8 }}><button type="button" className="secondary-button" onClick={() => reviewPlan(plan.id, 'Rejected')}>Reject</button><button type="button" className="primary-button" onClick={() => reviewPlan(plan.id, 'Approved')}>Approve</button></div></div></div>}
      </article>)}
    </section>
    <p className="form-message">Phase 3 calculation and approval are currently stored in this browser for the first UI implementation. The next integration step is to add dedicated Google Sheets / Apps Script actions so Supervisor submissions and Manager decisions sync across devices.</p>
  </div>;
}

function App() {



  const [role, setRole] = useState<Role | null>(null)



const [managerPage, setManagerPage] = useState<
  'dashboard' | 'machine-management' | 'order-management' | 'order-tracking' | 'production-planning' | 'phase2-workspace' | 'phase3-capacity'
>('dashboard')


  const [email, setEmail] = useState('')



  const [password, setPassword] = useState('')



  const [showPassword, setShowPassword] = useState(false)



  const [loginMessage, setLoginMessage] = useState('')



  const [entries, setEntries] = useState<Entry[]>(loadEntries)

  const entriesLoadVersion = useRef(0)



  // Load production history from Apps Script on page load.

  useEffect(() => {

    let cancelled = false



    async function loadBackendEntries() {

      try {

        const versionAtRequest = entriesLoadVersion.current

        const records = await fetchBackendEntries()

        if (!cancelled && versionAtRequest === entriesLoadVersion.current) setEntries(records)

      } catch (error) {

        console.error('Unable to load production records from backend:', error)

        if (!cancelled) {

          const detail = error instanceof Error ? error.message : 'Unknown error'

          window.alert(`Unable to load production records: ${detail}`)

        }

      }

    }



    void loadBackendEntries()

    return () => { cancelled = true }

  }, [])



  const [machines, setMachines] = useState<Machine[]>(() => loadStored<Machine>(machinesStorageKey))

  const [machineSyncState, setMachineSyncState] = useState<'loading' | 'loaded' | 'error'>('loading')

useEffect(() => {
  let cancelled = false;

  async function loadProblemLog() {
    try {
      const problems = await fetchBackendProblems();

      if (!cancelled) {
        setProblemLogEntries(problems);
      }
    } catch (error) {
      console.error('Unable to load Problem Log:', error);
    }
  }

  void loadProblemLog();

  return () => {
    cancelled = true;
  };
}, []);

  useEffect(() => {
    let cancelled = false;
    async function loadOrders() {
      setOrdersLoading(true);
      try {
        const records = await fetchBackendOrders();
        if (!cancelled) setOrders(records);
      } catch (error) {
        console.error('Unable to load orders:', error);
        if (!cancelled) setOrderMessage(error instanceof Error ? error.message : 'Unable to load orders.');
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    }
    void loadOrders();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {

    let cancelled = false

    async function loadMachines() {

      try {

        const records = await fetchBackendMachines()

        if (!cancelled) { setMachines(records); setMachineSyncState('loaded') }

      } catch (error) {

        console.error('Unable to load machines from Google Sheets:', error)

        if (!cancelled) {

          setMachineSyncState('error')

          const detail = error instanceof Error ? error.message : 'Unknown error'

          window.alert(`Unable to load machines from Google Sheets. Check your internet connection and Apps Script deployment. ${detail}`)

        }

      }

    }

    void loadMachines()

    return () => { cancelled = true }

  }, [])



  const [targets, setTargets] = useState<MachineTarget[]>(() => loadStored<MachineTarget>(targetsStorageKey))



  useEffect(() => {



    try {



      window.localStorage.setItem(entriesStorageKey, JSON.stringify(entries))



    } catch {



      // Keep the in-memory demo usable if browser storage is unavailable.



    }



  }, [entries])



  useEffect(() => { window.localStorage.setItem(machinesStorageKey, JSON.stringify(machines)) }, [machines])



  useEffect(() => { window.localStorage.setItem(targetsStorageKey, JSON.stringify(targets)) }, [targets])



  const openProblems = entries.filter((entry) => entry.rejected > 0).length



  const [filterDate, setFilterDate] = useState('')



  const [filterShift, setFilterShift] = useState('All shifts')



  const [filterMachine, setFilterMachine] = useState('All machines')

  const [problemStatuses, setProblemStatuses] = useState<Record<string, ProblemStatus>>({})
  
  const [problemLogEntries, setProblemLogEntries] = useState<ProblemLogEntry[]>([]); 
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderTrackingSearch, setOrderTrackingSearch] = useState('');
  const [selectedTrackingOrderId, setSelectedTrackingOrderId] = useState('');
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderMessage, setOrderMessage] = useState('');
  const [processJourneys, setProcessJourneys] = useState<ProcessJourneyRecord[]>([]);
  const [processJourneyLoading, setProcessJourneyLoading] = useState(false);
  const [processJourneySaving, setProcessJourneySaving] = useState(false);
  const [processJourneyMessage, setProcessJourneyMessage] = useState('');
  const [planningOrderId, setPlanningOrderId] = useState('');
  const [planningProcess, setPlanningProcess] = useState('Turning');
  const [planningMachineId, setPlanningMachineId] = useState('');
  const planningSequence = PROCESS_SEQUENCE_MAP[planningProcess] ?? '';
  const [planningQty, setPlanningQty] = useState('');
  const [progressJourneyId, setProgressJourneyId] = useState('');
  const [progressCompletedQty, setProgressCompletedQty] = useState('');
  const [progressSaving, setProgressSaving] = useState(false);


  useEffect(() => {
    let cancelled = false;
    async function loadProcessJourney() {
      setProcessJourneyLoading(true);
      try {
        const records = await fetchBackendProcessJourney();
        if (!cancelled) setProcessJourneys(records);
      } catch (error) {
        console.error('Unable to load production plans:', error);
        if (!cancelled) setProcessJourneyMessage(error instanceof Error ? error.message : 'Unable to load production plans.');
      } finally {
        if (!cancelled) setProcessJourneyLoading(false);
      }
    }
    void loadProcessJourney();
    return () => { cancelled = true; };
  }, []);


  const [orderForm, setOrderForm] = useState<OrderFormState>({
    orderDate: todayDate(), customerName: '', productName: '', partNumber: '',
    orderQuantity: '', materialSpecification: '', deliveryDate: '',
    priority: 'Normal', remarks: '',
  });


  const [problemDateFilter, setProblemDateFilter] = useState('')

  const [problemMachineFilter, setProblemMachineFilter] = useState('All machines')

  const [problemShiftFilter, setProblemShiftFilter] = useState('All shifts')

  const [problemStatusFilter, setProblemStatusFilter] = useState<'All' | ProblemStatus>('All')

  const [problemSearch, setProblemSearch] = useState('')



  const [form, setForm] = useState({ date: todayDate(), shift: 'Morning', machine: '', product: '', actual: '', rejected: '0', reason: '', otherReason: '', shortfallReason: '', shortfallOtherReason: '' })



  const applicableTarget = targets.find((item) => item.machineId === form.machine && item.date === form.date)



  const activeMachines = machines.filter((machine) => machine.status === 'Active')



  const actualQuantity = Number(form.actual || 0)



  const rejectedQuantity = Number(form.rejected || 0)



  const targetQuantity = applicableTarget?.quantity ?? 0



  const shortfallQuantity = Math.max(0, targetQuantity - actualQuantity)
  void shortfallQuantity; // Retained for the legacy production-entry calculation.



  const showShortfallDetails = !!applicableTarget && form.actual !== '' && actualQuantity < targetQuantity



  const showRejectionDetails = rejectedQuantity > 0



  const good = Math.max(0, actualQuantity - rejectedQuantity)
  void good; // Retained for the legacy production-entry calculation.



  const filtered = useMemo(() => entries.filter((e) => (!filterDate || e.date === filterDate) && (filterShift === 'All shifts' || e.shift === filterShift) && (filterMachine === 'All machines' || e.machine === filterMachine)), [entries, filterDate, filterShift, filterMachine])

  const problemRows = problemLogEntries.map((problem) => {
  const entry = {
    date: problem.productionDate,
    shift: problem.shift,
    machine: problem.machineName,
    product: '',
    target: 0,
    actual: 0,
    shortfallReason: problem.shortfallReason,
  };

  const key = `${problem.productionDate}-${problem.machineName}-${problem.shift}-${problem.shortfallReason}`;

  return {
    entry,
    key,
    status: problemStatuses[key] ?? problem.status,
  };
});

  const problemMachineOptions = Array.from(new Set(problemRows.map(({ entry }) => entry.machine).filter(Boolean)))

  const problemShiftOptions = Array.from(new Set(problemRows.map(({ entry }) => entry.shift).filter(Boolean)))

  const filteredProblemRows = problemRows.filter(({ entry }) =>

    (!problemDateFilter || entry.date === problemDateFilter) &&

    (problemMachineFilter === 'All machines' || entry.machine === problemMachineFilter) &&

    (problemShiftFilter === 'All shifts' || entry.shift === problemShiftFilter) &&

    (!problemSearch.trim() || `${entry.machine} ${machines.find((machine) => machine.id === entry.machine)?.name ?? ''} ${entry.shortfallReason ?? ''}`.toLowerCase().includes(problemSearch.trim().toLowerCase()))

  )

  const visibleProblemRows = filteredProblemRows.filter((row) => problemStatusFilter === 'All' || row.status === problemStatusFilter)

  const problemStatusCounts = visibleProblemRows.reduce((counts, row) => {

    counts[row.status] += 1

    return counts

  }, { Pending: 0, 'In Progress': 0, Resolved: 0 })







  async function saveProductionProgress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcessJourneyMessage('');
    const selectedPlan = processJourneys.find((plan) => String(plan.Journey_ID) === progressJourneyId);
    const completedQty = Number(progressCompletedQty);

    if (!selectedPlan || !Number.isFinite(completedQty) || completedQty < 0) {
      setProcessJourneyMessage('Select a saved process plan and enter a valid completed quantity.');
      return;
    }
    const plannedQty = Number(selectedPlan.Planned_Qty);
    if (!Number.isFinite(plannedQty) || plannedQty <= 0 || completedQty > plannedQty) {
      setProcessJourneyMessage(`Completed quantity must be between 0 and ${selectedPlan.Planned_Qty}.`);
      return;
    }

    setProgressSaving(true);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'updateProductionProgress',
          Journey_ID: selectedPlan.Journey_ID,
          Completed_Qty: completedQty,
        }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        throw new Error(result.error || result.message || `Progress update failed (HTTP ${response.status}).`);
      }
      setProcessJourneys(await fetchBackendProcessJourney());
      setProgressCompletedQty(String(result.completedQty ?? completedQty));
      setProcessJourneyMessage(`Progress saved: ${result.completedQty ?? completedQty} completed, ${result.pendingQty ?? Math.max(0, plannedQty - completedQty)} pending.`);
    } catch (error) {
      setProcessJourneyMessage(error instanceof Error ? error.message : 'Unable to update production progress.');
    } finally {
      setProgressSaving(false);
    }
  }

  async function saveProductionPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcessJourneyMessage('');
    const quantity = Number(planningQty);
    if (!planningOrderId || !planningProcess || !planningMachineId || !Number.isInteger(Number(planningSequence)) || Number(planningSequence) < 1 || !Number.isFinite(quantity) || quantity <= 0) {
      setProcessJourneyMessage('Please select an order, process and machine, and enter a valid planned quantity.');
      return;
    }
    setProcessJourneySaving(true);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveProductionPlan',
          Order_ID: planningOrderId,
          Process_Sequence: Number(planningSequence),
          Process_Name: planningProcess,
          Machine_ID: planningMachineId,
          Planned_Qty: quantity,
        }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        throw new Error(result.error || result.message || `Plan save failed (HTTP ${response.status}).`);
      }
      setProcessJourneys(await fetchBackendProcessJourney());
      setProcessJourneyMessage(`Production plan saved for ${planningOrderId}.`);
      setPlanningQty('');
    } catch (error) {
      setProcessJourneyMessage(`Unable to save plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setProcessJourneySaving(false);
    }
  }

async function saveOrderEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrderMessage('');
    const quantity = Number(orderForm.orderQuantity);
    if (!orderForm.orderDate || !orderForm.customerName.trim() || !orderForm.productName.trim() ||
        !Number.isFinite(quantity) || quantity <= 0 || !orderForm.deliveryDate) {
      setOrderMessage('Please complete all required fields and enter a valid quantity.');
      return;
    }
    setOrderSaving(true);
    try {
      const payload = {
        action: 'saveOrder',
        orderDate: formatDateForSheet(orderForm.orderDate),
        customerName: orderForm.customerName.trim(),
        productName: orderForm.productName.trim(),
        partNumber: orderForm.partNumber.trim(),
        orderQuantity: quantity,
        materialSpecification: orderForm.materialSpecification.trim(),
        deliveryDate: formatDateForSheet(orderForm.deliveryDate),
        priority: orderForm.priority,
        remarks: orderForm.remarks.trim(),
      };
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const responseText = await response.text();
      let result: { success?: boolean; message?: string; orderId?: string };
      try { result = JSON.parse(responseText); }
      catch { throw new Error('The order endpoint returned an unreadable response.'); }
      if (!response.ok || result.success !== true) {
        throw new Error(result.message || `Order save failed (HTTP ${response.status}).`);
      }
      setOrders(await fetchBackendOrders());
      setOrderMessage(`Order ${result.orderId || ''} saved successfully.`);
      setOrderForm({
        orderDate: todayDate(), customerName: '', productName: '', partNumber: '',
        orderQuantity: '', materialSpecification: '', deliveryDate: '',
        priority: 'Normal', remarks: '',
      });
    } catch (error) {
      setOrderMessage(`Unable to save order: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setOrderSaving(false);
    }
  }

  function login(event: React.FormEvent<HTMLFormElement>) {



    event.preventDefault()



    const account = demoAccounts.find((item) => item.email === email.trim().toLowerCase() && item.password === password)



    if (!account) { setLoginMessage('Those demo credentials do not match. Choose a demo account below.'); return }



    setLoginMessage('')



    setRole(account.role)



  }



  function logout() { setRole(null); setPassword(''); setLoginMessage('') }

  // Keep the legacy save handler in the source without triggering noUnusedLocals.
  void saveEntry;



  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {



    event.preventDefault()



    const rejected = Number(form.rejected || 0)



    const actual = Number(form.actual)



    const reason = form.reason === 'Other' ? form.otherReason.trim() : form.reason



    const shortfallReason = form.shortfallReason === 'Other' ? form.shortfallOtherReason.trim() : form.shortfallReason



    if (!activeMachines.some((machine) => machine.id === form.machine) || !applicableTarget || rejected > actual || (showRejectionDetails && !reason) || (showShortfallDetails && !shortfallReason)) return



    const payload = {



      Production_Date: form.date,



      Shift: form.shift,



      Machine_ID: form.machine,



      Product_Part: form.product.trim(),



      Target_Qty: applicableTarget.quantity,



      Actual_Qty: actual,



      Rejected_Qty: rejected,



      Good_Qty: actual - rejected,



      Remarks: reason || '',



      Supervisor_ID: email.trim().toLowerCase(),



    }







    try {











const response = await fetch(API_URL, {



  method: 'POST',



  headers: {



    'Content-Type': 'text/plain;charset=utf-8',



  },



  body: JSON.stringify(payload),



})











      if (!response.ok) throw new Error(`POST ${API_URL} returned HTTP ${response.status}.`)



      if (response.redirected && /accounts\.google\.com/i.test(response.url)) {



        throw new Error('The Apps Script endpoint redirected to Google sign-in.')



      }







      const responseText = await response.text()



      let result: unknown



      try {



        result = JSON.parse(responseText)



      } catch {



        throw new Error('The backend returned an unreadable response.')



      }



      const confirmation = result as { success?: unknown; status?: unknown }



      if (confirmation.success !== true && confirmation.status !== 'success') {



        throw new Error('The backend did not confirm that the entry was saved.')



      }





// Save shortfall to Problem_Log only when a reason is provided.

      if (showShortfallDetails && shortfallReason) {

        const problemResponse = await fetch(API_URL, {

          method: 'POST',

          headers: {

            'Content-Type': 'text/plain;charset=utf-8',

          },

          body: JSON.stringify({

            action: 'saveProblemLog',

            productionDate: payload.Production_Date,

            machineName:

              activeMachines.find((machine) => machine.id === form.machine)?.name

              || form.machine,

            shift: payload.Shift,

            shortfallReason,

          }),

        })



        if (!problemResponse.ok) {

          throw new Error(

            `Problem Log request returned HTTP ${problemResponse.status}.`

          )

        }



        const problemText = await problemResponse.text()

        let problemResult: { success?: boolean; message?: string }



        try {

          problemResult = JSON.parse(problemText)

        } catch {

          throw new Error('Problem Log returned an unreadable response.')

        }



        if (problemResult.success !== true) {

          throw new Error(

            problemResult.message || 'Problem Log was not saved.'

          )

        }

      }


      // Save rejection to Problem_Log only when a reason is provided.
      if (showRejectionDetails && reason) {
        const rejectionResponse = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
          },
          body: JSON.stringify({
            action: 'saveProblemLog',
            productionDate: payload.Production_Date,
            machineName:
              activeMachines.find((machine) => machine.id === form.machine)?.name
              || form.machine,
            shift: payload.Shift,
            problemType: 'Rejection',
            reason,
          }),
        });

        if (!rejectionResponse.ok) {
          throw new Error(
            `Rejection Problem Log request returned HTTP ${rejectionResponse.status}.`
          );
        }

        const rejectionText = await rejectionResponse.text();
        let rejectionResult: { success?: boolean; message?: string };

        try {
          rejectionResult = JSON.parse(rejectionText);
        } catch {
          throw new Error('Rejection Problem Log returned an unreadable response.');
        }

        if (rejectionResult.success !== true) {
          throw new Error(
            rejectionResult.message || 'Rejection Problem Log was not saved.'
          );
        }
      }


      entriesLoadVersion.current += 1

      const savedEntry: Entry = { date: payload.Production_Date, shift: payload.Shift, machine: payload.Machine_ID, product: payload.Product_Part, target: payload.Target_Qty, actual: payload.Actual_Qty, good: payload.Good_Qty, rejected: payload.Rejected_Qty, reason: reason || '—', remarks: payload.Remarks, shortfallReason: showShortfallDetails ? shortfallReason : undefined, rejectionReason: showRejectionDetails ? reason : undefined }

      setEntries((current) => [savedEntry, ...current])



      setForm((current) => ({ ...current, product: '', actual: '', rejected: '0', reason: '', otherReason: '', shortfallReason: '', shortfallOtherReason: '' }))



    } catch (error) {



      const message = error instanceof Error ? error.message : 'Unknown network or backend error.'



      window.alert(`Unable to save production entry: ${message}`)



    }



  }







  const managerSums = filtered.reduce((a, e) => ({ target: a.target + e.target, actual: a.actual + e.actual, good: a.good + e.good, rejected: a.rejected + e.rejected }), { target: 0, actual: 0, good: 0, rejected: 0 })



  const planningSummary = processJourneys.reduce(
    (summary, journey) => {
      const planned = Number(journey.Planned_Qty) || 0;
      const completed = Number(journey.Completed_Qty) || 0;
      const pendingValue = Number(journey.Pending_Qty);
      summary.planned += planned;
      summary.completed += completed;
      summary.pending += Number.isFinite(pendingValue)
        ? Math.max(0, pendingValue)
        : Math.max(0, planned - completed);
      const orderId = String(journey.Order_ID || '').trim();
      if (orderId) summary.orders.add(orderId);
      return summary;
    },
    { planned: 0, completed: 0, pending: 0, orders: new Set<string>() }
  );

  const managerKpis = [{ label: 'Total Target', value: managerSums.target, meta: 'units planned', color: 'blue' }, { label: 'Total Actual', value: managerSums.actual, meta: 'units produced', color: 'navy' }, { label: 'Good Quantity', value: managerSums.good, meta: 'accepted units', color: 'green' }, { label: 'Rejected Quantity', value: managerSums.rejected, meta: 'units rejected', color: 'red' }, { label: 'Achievement', value: `${managerSums.target ? Math.round(managerSums.actual / managerSums.target * 100) : 0}%`, meta: 'of target achieved', color: 'purple' }, { label: 'Shortfall', value: Math.max(0, managerSums.target - managerSums.actual), meta: 'units to target', color: 'amber' }]







  if (!role) return <main className="login-page"><section className="login-shell">



    <div className="login-panel"><div className="brand"><div className="brand-mark">{icon('gear')}</div><div><strong>Kinetic Gears, Nagpur</strong><span>Production Monitoring System</span></div></div>



      <div className="login-content"><span className="eyebrow">PRODUCTION PORTAL</span><h1>Welcome back</h1><p className="login-intro">Sign in to continue to Production Monitoring</p>



        <form className="login-form" onSubmit={login}><label htmlFor="email">Email address</label><div className="input-wrap">{icon('mail')}<input id="email" type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>



          <label htmlFor="password">Password</label><div className="input-wrap">{icon('lock')}<input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button className="show-password" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{icon(showPassword ? 'eyeoff' : 'eye')}</button></div>



          {loginMessage && <p className="form-message" role="alert">{loginMessage}</p>}<button className="primary-button" type="submit">Login <span>{icon('arrow')}</span></button>



        </form>



      </div>



      <div className="demo-box"><div className="demo-title"><span>DEMO ACCESS</span><small>Select an account to autofill</small></div><div className="demo-cards">{demoAccounts.map((account) => <button className="demo-card" type="button" key={account.role} onClick={() => { setEmail(account.email); setPassword(account.password); setLoginMessage('') }}><span className="demo-avatar">{account.role[0]}</span><span className="demo-info"><strong>{account.role}</strong><small>{account.email}</small><small>Password: 1234</small></span><span className="demo-chevron">{icon('arrow')}</span></button>)}</div></div>



      <p className="login-footnote">Demo interface — Authentication is not connected</p>



    </div>



    <aside className="visual-panel"><div className="visual-photo"/><div className="visual-overlay"/><div className="visual-content"><div className="visual-kicker"><span/> PRECISION IN EVERY SHIFT</div><h2>Production.<br/>Quality.<br/><em>Performance.</em></h2><p className="visual-copy">Clear insight into every part, process, and production line.</p><div className="feature-list"><div>{icon('production')}<span>Track daily production</span></div><div>{icon('quality')}<span>Monitor rejected quantity</span></div><div>{icon('performance')}<span>Review machine performance</span></div></div><div className="visual-caption">ENGINEERED FOR BETTER OUTPUT</div></div><div className="image-credit">KINETIC GEARS · NAGPUR</div></aside>



  </section></main>







const pageTitle =
  managerPage === 'machine-management'
    ? 'Machine Management'
    : managerPage === 'order-management'
      ? 'Order Management'
      : managerPage === 'order-tracking'
        ? 'Order Tracking'
        : managerPage === 'production-planning'
          ? 'Production Planning'
          : managerPage === 'phase3-capacity'
            ? (role === 'Supervisor' ? 'Phase 3 — Capacity Calculation' : 'Phase 3 — Capacity Approval')
            : role === 'Supervisor'
            ? 'Supervisor Home'
            : 'Manager Production Dashboard'


  if (role && managerPage === 'phase2-workspace') {
    return <Phase2Workspace initialRole={role} initialEmail={email} onExit={() => setManagerPage('dashboard')} />;
  }

  return <div className="workspace"><aside className="sidebar"><a className="side-brand" href="#home" onClick={(e) => e.preventDefault()}><span className="side-logo">{icon('gear')}</span><span><b>KINETIC GEARS</b><small>PRODUCTION SYSTEM</small></span></a><div className="side-label">WORKSPACE</div><button className={`nav-item${role === 'Supervisor' || managerPage === 'dashboard' ? ' active' : ''}`} onClick={() => setManagerPage('dashboard')}>{icon('grid')}<span>{role === 'Supervisor' ? 'Supervisor Home' : 'Production Dashboard'}</span></button>{role === 'Manager' && <button className={`nav-item${managerPage === 'machine-management' ? ' active' : ''}`} onClick={() => setManagerPage('machine-management')}>{icon('gear')}<span>Machine Management</span></button>}{role === 'Supervisor' && (
  <button
    className={`nav-item${managerPage === 'order-management' ? ' active' : ''}`}
    onClick={() => setManagerPage('order-management')}
  >
    {icon('production')}
    <span>Order Management</span>
  </button>
)}{role === 'Manager' && (
  <button
    className={`nav-item${managerPage === 'order-tracking' ? ' active' : ''}`}
    onClick={() => setManagerPage('order-tracking')}
  >
    {icon('chart')}
    <span>Order Tracking</span>
  </button>
)}{role === 'Manager' && (
  <button className={`nav-item${managerPage === 'phase2-workspace' ? ' active' : ''}`} onClick={() => setManagerPage('phase2-workspace')}>
    {icon('factory')}<span>Phase 2 — Machine Tracking</span>
  </button>
)}{role === 'Manager' && (
  <button className={`nav-item${managerPage === 'phase3-capacity' ? ' active' : ''}`} onClick={() => setManagerPage('phase3-capacity')}>
    {icon('chart')}<span>Phase 3 — Capacity Approval</span>
  </button>
)} {role === 'Supervisor' && (
  <button className={`nav-item${managerPage === 'production-planning' ? ' active' : ''}`} onClick={() => setManagerPage('production-planning')}>
    {icon('production')}<span>Production Planning</span>
  </button>
)}{role === 'Supervisor' && (
  <button className={`nav-item${managerPage === 'phase3-capacity' ? ' active' : ''}`} onClick={() => setManagerPage('phase3-capacity')}>
    {icon('chart')}<span>Phase 3 — Capacity Calculation</span>
  </button>
)}{role === 'Supervisor' && <><a className="nav-item" href="#entry">{icon('factory')}<span>My Production</span></a><a className="nav-item" href="#records">{icon('chart')}<span>My Records</span></a></>}<div className="sidebar-bottom"><div className="user-chip"><span className="user-avatar">{role[0]}</span><span><b>{role}</b><small>{email}</small></span></div><button className="logout-button" onClick={logout}>{icon('logout')}<span>Logout</span></button></div></aside>



    <main className="dashboard"><header className="dash-header"><div><div className="breadcrumb">WORKSPACE <span>/</span> {role === 'Supervisor' ? 'SUPERVISOR' : 'MANAGER'}</div><h1>{pageTitle}</h1><p>{role === 'Supervisor' ? 'View assigned processes and record daily progress' : 'Plan and monitor machine processes, quality and dispatch'}</p></div><div className="header-date">{icon('calendar')}<span>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></div></header>



    {role === 'Supervisor' && managerPage === 'dashboard' ? <><section className="summary-grid"><article className="summary-card"><span className="summary-icon blue">{icon('factory')}</span><div><small>Production Entries</small><strong>{entries.length}</strong><span className="summary-note">Recorded in this demo</span></div></article><article className="summary-card"><span className="summary-icon amber">{icon('quality')}</span><div><small>Open Problems</small><strong>{openProblems}</strong><span className="summary-note">Needs review</span></div></article></section>



      <SupervisorHomeProductionTracking supervisorEmail={email} />


      <section className="surface records-surface" id="records"><div className="section-heading"><div><span className="section-index">02</span><div><h2>Today's Production Entries</h2><p>{entries.length} entries in the demo</p></div></div><button className="text-button" onClick={() => setEntries([])}>Reset sample data</button></div><EntryTable entries={entries} /></section></> : <>{managerPage === 'dashboard' ? <><section className="filter-bar"><label>Date<input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} /></label><label>Shift<select value={filterShift} onChange={(e) => setFilterShift(e.target.value)}><option>All shifts</option><option>Morning</option><option>Evening</option><option>Night</option></select></label><label>Machine<select value={filterMachine} onChange={(e) => setFilterMachine(e.target.value)}><option>All machines</option>{Array.from(new Set([...machines.map((m) => m.id), ...entries.map((e) => e.machine)])).map((m) => <option key={m}>{m}</option>)}</select></label></section><section className="kpi-grid">{managerKpis.map((item) => <article className="kpi-card" key={item.label}><span className={`kpi-dot ${item.color}`} /><small>{item.label}</small><strong>{item.value}</strong><span>{item.meta}</span></article>)}</section><section className="surface records-surface" style={{ marginBottom: 20 }}>
  <div className="section-heading">
    <div><span className="section-index">02</span><div><h2>Production Planning Summary</h2><p>Planned process quantities and current completion status</p></div></div>
    <span className="result-count">{planningSummary.orders.size} ORDERS / {processJourneys.length} PROCESS PLANS</span>
  </div>
  {processJourneyLoading ? <p>Loading production planning data...</p> : (
    <div className="kpi-grid">
      {[
        { label: 'Total Planned Qty', value: planningSummary.planned, meta: 'units planned', color: 'blue' },
        { label: 'Completed Qty', value: planningSummary.completed, meta: 'units completed', color: 'green' },
        { label: 'Pending Qty', value: planningSummary.pending, meta: 'units pending', color: 'amber' },
        { label: 'Orders Under Planning', value: planningSummary.orders.size, meta: 'orders with a process plan', color: 'purple' },
      ].map((item) => <article className="kpi-card" key={item.label}><span className={`kpi-dot ${item.color}`} /><small>{item.label}</small><strong>{item.value}</strong><span>{item.meta}</span></article>)}
    </div>
  )}
  {processJourneyMessage && <p role="status">{processJourneyMessage}</p>}
</section><section className="surface records-surface manager-table"><div className="section-heading"><div><span className="section-index">03</span><div><h2>Production Summary Report</h2><p>Order-wise and process-wise planned, completed and pending quantities</p></div></div><span className="result-count">{processJourneys.length} PROCESS PLANS</span></div><div className="table-wrap"><table><thead><tr><th>Order ID</th><th>Process</th><th>Machine</th><th>Planned Qty</th><th>Completed Qty</th><th>Pending Qty</th><th>Completion</th><th>Status</th></tr></thead><tbody>{processJourneys.map((journey, index) => { const planned = Number(journey.Planned_Qty) || 0; const completed = Number(journey.Completed_Qty) || 0; const pending = Number.isFinite(Number(journey.Pending_Qty)) ? Math.max(0, Number(journey.Pending_Qty)) : Math.max(0, planned - completed); const completion = planned > 0 ? Math.min(100, Math.round(completed / planned * 100)) : 0; return <tr key={journey.Journey_ID || index}><td><b>{journey.Order_ID || '—'}</b></td><td>{journey.Process_Name || '—'}</td><td>{journey.Machine_ID || '—'}</td><td>{planned}</td><td className="good-cell">{completed}</td><td>{pending}</td><td><span className="achievement">{completion}%</span></td><td>{journey.Process_Status || (pending === 0 ? 'Completed' : completed > 0 ? 'In Progress' : 'Pending')}</td></tr> })}</tbody></table>{processJourneys.length === 0 && <div className="empty-state">No production plans available.</div>}</div></section><section className="surface records-surface manager-table"><div className="section-heading"><div><span className="section-index">01</span><div><h2>Machine-wise Production Details</h2><p>Output quality and target attainment by machine</p></div></div><span className="result-count">{filtered.length} MACHINES / RECORDS</span></div><div className="table-wrap"><table><thead><tr><th>Machine</th><th>Target</th><th>Actual</th><th>Good Qty.</th><th>Rejected</th><th>Achievement</th><th>Shortfall</th><th>Shortfall Reason</th><th>Rejection Reason</th></tr></thead><tbody>{filtered.map((e, i) => <tr key={`${e.machine}-${i}`}><td><b className="machine-name">{icon('gear')}{e.machine}</b></td><td>{e.target}</td><td>{e.actual}</td><td className="good-cell">{e.good}</td><td className={e.rejected ? 'reject-cell' : ''}>{e.rejected}</td><td><span className="achievement">{e.target ? Math.round(e.actual / e.target * 100) : 0}%</span></td><td>{Math.max(0, e.target - e.actual)}</td><td>{e.target > e.actual ? (e.shortfallReason || '—') : '—'}</td><td>{e.rejected > 0 ? (e.rejectionReason || '—') : '—'}</td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-state">No production records match these filters.</div>}</div></section><section className="surface records-surface manager-table"><div className="section-heading"><div><span className="section-index">02</span><div><h2>Production Problem Log</h2><p>{visibleProblemRows.length} problems match these filters</p></div></div></div><div className="manager-table-tools"><label>Production Date<input type="date" value={problemDateFilter} onChange={(event) => setProblemDateFilter(event.target.value)} /></label><label>Machine<select value={problemMachineFilter} onChange={(event) => setProblemMachineFilter(event.target.value)}><option>All machines</option>{problemMachineOptions.map((machine) => <option key={machine} value={machine}>{machine}</option>)}</select></label><label>Shift<select value={problemShiftFilter} onChange={(event) => setProblemShiftFilter(event.target.value)}><option>All shifts</option>{problemShiftOptions.map((shift) => <option key={shift} value={shift}>{shift}</option>)}</select></label><label>Status<select value={problemStatusFilter} onChange={(event) => setProblemStatusFilter(event.target.value as 'All' | ProblemStatus)}><option>All</option><option>Pending</option><option>In Progress</option><option>Resolved</option></select></label><input aria-label="Search machine ID, name, or shortfall reason" placeholder="Search machine or reason" value={problemSearch} onChange={(event) => setProblemSearch(event.target.value)} /><button className="secondary-button" type="button" onClick={() => { setProblemDateFilter(''); setProblemMachineFilter('All machines'); setProblemShiftFilter('All shifts'); setProblemStatusFilter('All'); setProblemSearch('') }}>Clear Filters</button></div><section className="kpi-grid"><article className="kpi-card"><small>Pending problems</small><strong>{problemStatusCounts.Pending}</strong></article><article className="kpi-card"><small>In Progress problems</small><strong>{problemStatusCounts['In Progress']}</strong></article><article className="kpi-card"><small>Resolved problems</small><strong>{problemStatusCounts.Resolved}</strong></article></section><div className="table-wrap"><table><thead><tr><th>Production Date</th><th>Shift</th><th>Machine</th><th>Shortfall Reason</th><th>Status</th></tr></thead><tbody>{visibleProblemRows.map(({ entry, key, status }) => <tr key={key}><td>{entry.date}</td><td>{entry.shift}</td><td><b>{entry.machine}</b></td><td>{entry.shortfallReason}</td><td><select aria-label={`Problem status for ${entry.machine} on ${entry.date}`} value={status} onChange={async (event) => {
  const newStatus = event.target.value as ProblemStatus;
  setProblemStatuses((current) => ({ ...current, [key]: newStatus }));
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateProblemStatus',
        productionDate: entry.date,
        machineName: entry.machine,
        shift: entry.shift,
        shortfallReason: entry.shortfallReason,
        status: newStatus,
      }),
    });
    const responseText = await response.text();
    let result: { success?: boolean; message?: string };
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('Problem status endpoint returned an unreadable response.');
    }
    if (!response.ok || result.success !== true) {
      throw new Error(result.message || 'Status update failed.');
    }
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'Status update failed.');
  }
}}><option>Pending</option><option>In Progress</option><option>Resolved</option></select></td></tr>)}</tbody></table>{visibleProblemRows.length === 0 && <div className="empty-state">No production problems match these filters.</div>}</div></section></> : null}{managerPage === 'order-management' && (
  <section className="surface records-surface">
    <div className="section-heading">
      <div><span className="section-index">01</span><div><h2>Order Registration</h2><p>Register customer orders and maintain order records</p></div></div>
      <span className="draft-label">ORDER TRACKING</span>
    </div>
    <form className="entry-form" onSubmit={saveOrderEntry}>
      <div className="form-grid">
        <Field label="Order Date"><input type="date" value={orderForm.orderDate} onChange={(event) => setOrderForm({ ...orderForm, orderDate: event.target.value })} required /></Field>
        <Field label="Customer Name"><input value={orderForm.customerName} onChange={(event) => setOrderForm({ ...orderForm, customerName: event.target.value })} placeholder="Enter customer name" required /></Field>
        <Field label="Product Name"><input value={orderForm.productName} onChange={(event) => setOrderForm({ ...orderForm, productName: event.target.value })} placeholder="Enter product name" required /></Field>
        <Field label="Part Number"><input value={orderForm.partNumber} onChange={(event) => setOrderForm({ ...orderForm, partNumber: event.target.value })} placeholder="Enter part number" /></Field>
        <Field label="Order Quantity"><input type="number" min="1" step="1" value={orderForm.orderQuantity} onChange={(event) => setOrderForm({ ...orderForm, orderQuantity: event.target.value })} placeholder="Enter quantity" required /></Field>
        <Field label="Material Specification"><input value={orderForm.materialSpecification} onChange={(event) => setOrderForm({ ...orderForm, materialSpecification: event.target.value })} placeholder="e.g. EN8, MS, EN24" /></Field>
        <Field label="Delivery Date"><input type="date" value={orderForm.deliveryDate} onChange={(event) => setOrderForm({ ...orderForm, deliveryDate: event.target.value })} required /></Field>
        <Field label="Priority"><select value={orderForm.priority} onChange={(event) => setOrderForm({ ...orderForm, priority: event.target.value })}><option>Normal</option><option>High</option><option>Urgent</option></select></Field>
        <Field label="Remarks" wide><input value={orderForm.remarks} onChange={(event) => setOrderForm({ ...orderForm, remarks: event.target.value })} placeholder="Optional remarks" /></Field>
      </div>
      <div className="form-actions"><span>Order ID and Order Status are generated automatically. New orders appear first.</span><button className="primary-button save-button" type="submit" disabled={orderSaving}>{orderSaving ? 'Saving Order...' : 'Save Order'} <span>{icon('arrow')}</span></button></div>
      {orderMessage && <p className="form-message" role="status">{orderMessage}</p>}
    </form>
    <div className="section-heading" style={{ marginTop: 28 }}>
      <div><span className="section-index">02</span><div><h2>Registered Orders</h2><p>{orders.length} orders saved in Google Sheets</p></div></div>
      <button className="text-button" type="button" onClick={async () => {
        setOrdersLoading(true);
        try { setOrders(await fetchBackendOrders()); }
        catch (error) { setOrderMessage(error instanceof Error ? error.message : 'Unable to refresh orders.'); }
        finally { setOrdersLoading(false); }
      }}>Refresh Orders</button>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>Order ID</th><th>Order Date</th><th>Customer Name</th><th>Product Name</th><th>Part Number</th><th>Order Qty.</th><th>Material</th><th>Delivery Date</th><th>Priority</th><th>Order Status</th><th>Remarks</th></tr></thead>
        <tbody>{orders.map((order, index) => (
          <tr key={`${order['Order ID']}-${index}`}>
            <td><b>{order['Order ID'] || '—'}</b></td><td>{displayOrderDate(order['Order Date'])}</td>
            <td>{order['Customer Name'] || '—'}</td><td>{order['Product Name'] || '—'}</td>
            <td>{order['Part Number'] || '—'}</td><td>{order['Order Quantity'] || '—'}</td>
            <td>{order['Material Specification'] || '—'}</td><td>{displayOrderDate(order['Delivery Date'])}</td>
            <td>{order.Priority || '—'}</td><td>{order['Order Status'] || '—'}</td><td>{order.Remarks || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      {ordersLoading && <div className="empty-state">Loading orders...</div>}
      {!ordersLoading && orders.length === 0 && <div className="empty-state">No orders registered yet.</div>}
    </div>
  </section>
)}{managerPage === 'order-tracking' && (
  <section className="surface records-surface">
    <div className="section-heading">
      <div><span className="section-index">01</span><div><h2>End-to-End Order Tracking</h2><p>Follow registered orders from entry through production and dispatch</p></div></div>
      <button className="text-button" type="button" onClick={async () => {
        setOrdersLoading(true);
        try { setOrders(await fetchBackendOrders()); }
        catch (error) { setOrderMessage(error instanceof Error ? error.message : 'Unable to refresh orders.'); }
        finally { setOrdersLoading(false); }
      }}>Refresh Orders</button>
    </div>
    <div className="manager-table-tools">
      <input aria-label="Search order tracking" placeholder="Search Order ID, product or part number" value={orderTrackingSearch} onChange={(event) => {
        const query = event.target.value;
        setOrderTrackingSearch(query);
        const matchingOrders = orders.filter((order) => `${order['Order ID']} ${order['Product Name']} ${order['Part Number']}`.toLowerCase().includes(query.trim().toLowerCase()));
        // When the search narrows to one order, make that order drive the journey too.
        if (matchingOrders.length === 1) setSelectedTrackingOrderId(String(matchingOrders[0]['Order ID'] || '').trim());
      }} />
      <span className="result-count">{orders.filter((order) => `${order['Order ID']} ${order['Product Name']} ${order['Part Number']}`.toLowerCase().includes(orderTrackingSearch.trim().toLowerCase())).length} ORDERS</span>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>Order ID</th><th>Product / Part</th><th>Order Qty.</th><th>Delivery Date</th><th>Priority</th><th>Current Stage</th></tr></thead>
        <tbody>{orders.filter((order) => `${order['Order ID']} ${order['Product Name']} ${order['Part Number']}`.toLowerCase().includes(orderTrackingSearch.trim().toLowerCase())).map((order, index) => {
          // Resolve the current production step from the saved process plans for this order.
          const orderPlans = processJourneys
            .filter((plan) => String(plan.Order_ID || '').trim() === String(order['Order ID'] || '').trim())
            .sort((a, b) => Number(a.Process_Sequence || 0) - Number(b.Process_Sequence || 0));
          const currentPlan = orderPlans.find((plan) => {
            const planned = Number(plan.Planned_Qty || 0);
            const completed = Number(plan.Completed_Qty || 0);
            const status = String(plan.Process_Status || '').trim().toLowerCase();
            return status !== 'completed' && (planned <= 0 || completed < planned);
          });
          const allPlansCompleted = orderPlans.length > 0 && orderPlans.every((plan) => {
            const planned = Number(plan.Planned_Qty || 0);
            const completed = Number(plan.Completed_Qty || 0);
            const status = String(plan.Process_Status || '').trim().toLowerCase();
            return status === 'completed' || (planned > 0 && completed >= planned);
          });
          const currentStage = currentPlan
            ? `Process ${Number(currentPlan.Process_Sequence || 1)} — ${currentPlan.Process_Name || 'In Production'}`
            : allPlansCompleted
              ? 'Production Completed'
              : orderPlans.length > 0
                ? 'Production Planning'
                : 'Order Registered';
          return (
            <tr key={`${order['Order ID']}-${index}`} onClick={() => setSelectedTrackingOrderId(String(order['Order ID'] || '').trim())} style={{ cursor: 'pointer', background: selectedTrackingOrderId === String(order['Order ID'] || '').trim() ? '#eff6ff' : undefined }}>
              <td><b>{order['Order ID'] || '—'}</b></td>
              <td>{order['Product Name'] || '—'}<small style={{ display: 'block', color: '#64748b' }}>{order['Part Number'] || 'No part number'}</small></td>
              <td>{order['Order Quantity'] || '—'}</td>
              <td>{displayOrderDate(order['Delivery Date'])}</td>
              <td>{order.Priority || 'Normal'}</td>
              <td><span className="machine-status active">{currentStage}</span></td>
            </tr>
          );
        })}</tbody>
      </table>
      {ordersLoading && <div className="empty-state">Loading orders...</div>}
      {!ordersLoading && orders.length === 0 && <div className="empty-state">No registered orders found. Register an order first.</div>}
    </div>
    {(() => {
      const normalizedSearch = orderTrackingSearch.trim().toLowerCase();
      const matchingTrackingOrders = orders.filter((order) =>
        `${order['Order ID']} ${order['Product Name']} ${order['Part Number']}`
          .toLowerCase()
          .includes(normalizedSearch)
      );
      // If search returns exactly one order, that order drives the Journey.
      // Otherwise use the row the Manager explicitly selected, then fall back to the first order.
      const journeyOrder = (normalizedSearch && matchingTrackingOrders.length === 1
        ? matchingTrackingOrders[0]
        : orders.find((order) => String(order['Order ID'] || '').trim() === selectedTrackingOrderId))
        || matchingTrackingOrders[0]
        || orders.find((order) => String(order['Order ID'] || '').trim() !== '')
        || null;
      const journeyOrderId = String(journeyOrder?.['Order ID'] || '').trim();
      const journeyPlans = processJourneys
        .filter((plan) => String(plan.Order_ID || '').trim() === journeyOrderId)
        .sort((a, b) => Number(a.Process_Sequence || 0) - Number(b.Process_Sequence || 0));
      // Order Journey mirrors the Current Stage logic used in the order table.
      const isPlanDone = (plan: ProcessJourneyRecord | null) => !!plan && (
        String(plan.Process_Status || '').trim().toLowerCase() === 'completed' ||
        (Number(plan.Planned_Qty || 0) > 0 && Number(plan.Completed_Qty || 0) >= Number(plan.Planned_Qty || 0))
      );
      const currentPlan = journeyPlans.find((plan) => {
        const planned = Number(plan.Planned_Qty || 0);
        const completed = Number(plan.Completed_Qty || 0);
        const status = String(plan.Process_Status || '').trim().toLowerCase();
        return status !== 'completed' && (planned <= 0 || completed < planned);
      }) || null;
      const allPlansCompleted = journeyPlans.length > 0 && journeyPlans.every((plan) => isPlanDone(plan));
      const stages = ['Order Registration', 'Turning', 'Gear Hobbing', 'Gear Shaping', 'Heat Treatment', 'Grinding', 'Quality Inspection', 'Packing'];
      const stagePlans = stages.slice(1).map((stage) => journeyPlans.find((plan) => String(plan.Process_Name || '').trim().toLowerCase() === stage.toLowerCase()) || null);
      const currentProcessIndex = currentPlan
        ? stages.findIndex((stage) => stage.toLowerCase() === String(currentPlan.Process_Name || '').trim().toLowerCase())
        : -1;
      const stageStates = stages.map((_, index) => {
        if (!journeyOrder) return 'Pending';
        if (index === 0) return 'Completed';
        const plan = stagePlans[index - 1];
        if (plan && isPlanDone(plan)) return 'Completed';
        if (currentPlan && index === currentProcessIndex) return 'In Progress';
        // No process plan means it has not started yet. If all saved plans are done,
        // later unplanned journey stages stay Pending rather than being marked complete.
        return 'Pending';
      });
      if (allPlansCompleted) {
        stageStates.forEach((_state, index) => {
  if (index > 0 && stagePlans[index - 1] && isPlanDone(stagePlans[index - 1])) {
    stageStates[index] = 'Completed';
  }
});
      }
      return <>
        <div className="section-heading" style={{ marginTop: 28 }}>
          <div><span className="section-index">02</span><div><h2>Order Journey</h2><p>{journeyOrder ? `Progress for Order ${journeyOrderId}` : 'Register an order to begin tracking.'}</p></div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 12 }}>
          {stages.map((stage, index) => {
            const isDone = stageStates[index] === 'Completed';
            const isActive = stageStates[index] === 'In Progress';
            const plan = index === 0 ? null : stagePlans[index - 1];
            return <div key={stage} style={{ border: `1px solid ${isActive ? '#2563eb' : isDone ? '#bbf7d0' : '#dbe3ec'}`, borderRadius: 10, padding: 14, background: isActive ? '#2563eb' : isDone ? '#f0fdf4' : '#fff', color: isActive ? '#fff' : '#1e293b' }}>
              <div style={{ fontSize: 12, color: isActive ? '#dbeafe' : '#64748b', marginBottom: 7 }}>STEP {String(index + 1).padStart(2, '0')}</div>
              <strong style={{ fontSize: 13 }}>{stage}</strong>
              <div style={{ marginTop: 8, fontSize: 12, color: isActive ? '#fff' : isDone ? '#15803d' : '#94a3b8' }}>{stageStates[index]}</div>
              {plan && <small style={{ display: 'block', marginTop: 6, color: isActive ? '#dbeafe' : '#64748b' }}>Completed Qty: {Number(plan.Completed_Qty || 0)} / {Number(plan.Planned_Qty || 0)}</small>}
            </div>;
          })}
        </div>
        <div className="section-heading" style={{ marginTop: 30 }}>
          <div><span className="section-index">03</span><div><h2>Machine Journey</h2><p>{journeyOrder ? `Machine and process-wise progress for Order ${journeyOrderId}` : 'Select an order to view its machine journey.'}</p></div></div>
          <span className="result-count">{journeyPlans.length} PROCESS / MACHINE STEPS</span>
        </div>
        {journeyPlans.length === 0 ? (
          <div className="empty-state">No machine process plans are saved for this order yet. Create the process plans in Phase 2 — Machine Tracking to see the Machine Journey here.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {journeyPlans.map((plan, index) => {
              const planned = Math.max(0, Number(plan.Planned_Qty || 0));
              const completed = Math.max(0, Number(plan.Completed_Qty || 0));
              const pending = Number.isFinite(Number(plan.Pending_Qty))
                ? Math.max(0, Number(plan.Pending_Qty))
                : Math.max(0, planned - completed);
              const complete = isPlanDone(plan);
              const active = !complete && completed > 0;
              const status = complete ? 'Completed' : active ? 'In Progress' : String(plan.Process_Status || 'Pending');
              const percent = planned > 0 ? Math.min(100, Math.round((completed / planned) * 100)) : 0;
              const borderColor = complete ? '#bbf7d0' : active ? '#2563eb' : '#dbe3ec';
              const background = active ? '#2563eb' : complete ? '#f0fdf4' : '#fff';
              const foreground = active ? '#fff' : '#1e293b';
              return (
                <article key={String(plan.Journey_ID || `${plan.Process_Sequence}-${index}`)} style={{ border: `1px solid ${borderColor}`, borderRadius: 10, padding: 14, background, color: foreground, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: active ? '#dbeafe' : '#64748b' }}>STEP {String(index + 1).padStart(2, '0')}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: active ? '#fff' : complete ? '#15803d' : '#64748b' }}>{status}</span>
                  </div>
                  <strong style={{ display: 'block', fontSize: 14 }}>{plan.Process_Name || 'Process'}</strong>
                  <div style={{ marginTop: 7, fontSize: 12, color: active ? '#dbeafe' : '#64748b' }}>Machine: <b style={{ color: foreground }}>{plan.Machine_ID || 'Not assigned'}</b></div>
                  <div style={{ marginTop: 5, fontSize: 12, color: active ? '#dbeafe' : '#64748b' }}>Sequence: {plan.Process_Sequence || index + 1}</div>
                  <div style={{ marginTop: 12, fontSize: 12, color: active ? '#dbeafe' : '#64748b' }}>Completed: <b style={{ color: foreground }}>{completed.toLocaleString('en-IN')} / {planned.toLocaleString('en-IN')}</b></div>
                  <div style={{ height: 6, background: active ? 'rgba(255,255,255,.25)' : '#e2e8f0', borderRadius: 99, overflow: 'hidden', marginTop: 7 }}>
                    <div style={{ width: `${percent}%`, height: '100%', background: active ? '#fff' : complete ? '#16a34a' : '#64748b', borderRadius: 99 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8, fontSize: 11, color: active ? '#dbeafe' : '#64748b' }}>
                    <span>{percent}% complete</span><span>{pending.toLocaleString('en-IN')} pending</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </>;
    })()}
    {orderMessage && <p className="form-message" role="status">{orderMessage}</p>}
  </section>
)}
{managerPage === 'production-planning' && (
  <section className="surface records-surface">
    <div className="section-heading">
      <div><span className="section-index">02</span><div><h2>Production Planning</h2><p>Assign a process, machine and planned quantity to a registered order</p></div></div>
      <button className="text-button" type="button" onClick={async () => {
        setProcessJourneyLoading(true);
        try { setProcessJourneys(await fetchBackendProcessJourney()); setProcessJourneyMessage('Production plans refreshed.'); }
        catch (error) { setProcessJourneyMessage(error instanceof Error ? error.message : 'Unable to refresh plans.'); }
        finally { setProcessJourneyLoading(false); }
      }}>Refresh Plans</button>
    </div>
    <form className="entry-form" onSubmit={saveProductionPlan}>
      <div className="form-grid">
        <Field label="Order"><select value={planningOrderId} onChange={(event) => setPlanningOrderId(event.target.value)} required>
          <option value="">Select order</option>
          {orders.map((order, index) => <option key={`${order['Order ID']}-${index}`} value={order['Order ID']}>{order['Order ID']} — {order['Product Name'] || order['Part Number'] || 'Order'}</option>)}
        </select></Field>
        <Field label="Process"><select value={planningProcess} onChange={(event) => setPlanningProcess(event.target.value)} required>
          {['Turning', 'Gear Hobbing', 'Gear Shaping', 'Heat Treatment', 'Grinding', 'Quality Inspection', 'Packing'].map((process) => <option key={process} value={process}>{process}</option>)}
        </select></Field>
        <Field label="Machine"><select value={planningMachineId} onChange={(event) => setPlanningMachineId(event.target.value)} required>
          <option value="">Select active machine</option>
          {activeMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.id} — {machine.name}</option>)}
        </select></Field>
        <Field label="Automatic Sequence"><input type="number" value={planningSequence} readOnly aria-readonly="true" /></Field>
        <Field label="Planned Quantity"><input type="number" min="1" step="1" value={planningQty} onChange={(event) => setPlanningQty(event.target.value)} placeholder="Enter planned quantity" required /></Field>
      </div>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={processJourneySaving}>{processJourneySaving ? 'Saving Plan…' : 'Save Production Plan'}</button></div>
    </form>
    {processJourneyMessage && <p className="form-message" role="status">{processJourneyMessage}</p>}
    <div className="section-heading" style={{ marginTop: 28 }}>
      <div><span className="section-index">03</span><div><h2>Production Progress Update</h2><p>Update cumulative completed quantity for an existing process plan</p></div></div>
    </div>
    <form className="entry-form" onSubmit={saveProductionProgress}>
      <div className="form-grid">
        <Field label="Saved Process Plan">
          <select value={progressJourneyId} onChange={(event) => {
            const nextId = event.target.value;
            setProgressJourneyId(nextId);
            const selected = processJourneys.find((plan) => String(plan.Journey_ID) === nextId);
            setProgressCompletedQty(selected ? String(selected.Completed_Qty ?? 0) : '');
          }} required>
            <option value="">Select process plan</option>
            {processJourneys.map((plan, index) => <option key={plan.Journey_ID || index} value={String(plan.Journey_ID)}>
              {plan.Journey_ID} — {plan.Order_ID} — {plan.Process_Name} (planned {plan.Planned_Qty}, completed {plan.Completed_Qty ?? 0})
            </option>)}
          </select>
        </Field>
        <Field label="Completed Quantity (cumulative)">
          <input type="number" min="0" step="1" value={progressCompletedQty} onChange={(event) => setProgressCompletedQty(event.target.value)} placeholder="Enter total completed quantity" required />
        </Field>
      </div>
      {progressJourneyId && (() => {
        const selected = processJourneys.find((plan) => String(plan.Journey_ID) === progressJourneyId);
        const planned = selected ? Number(selected.Planned_Qty) : 0;
        const completed = Number(progressCompletedQty || 0);
        return <p className="form-message">Pending after update: {Math.max(0, planned - completed)}</p>;
      })()}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={progressSaving || processJourneys.length === 0}>
          {progressSaving ? 'Saving Progress…' : 'Save Progress Update'}
        </button>
      </div>
    </form>
    <div className="section-heading" style={{ marginTop: 28 }}>
      <div><span className="section-index">03</span><div><h2>Saved Process Plans</h2><p>Process sequence and quantities returned from Google Sheets</p></div></div>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>Journey ID</th><th>Order ID</th><th>Sequence</th><th>Process</th><th>Machine</th><th>Planned Qty</th><th>Completed</th><th>Pending</th><th>Status</th></tr></thead>
        <tbody>{processJourneys.map((plan, index) => <tr key={plan.Journey_ID || `${plan.Order_ID}-${plan.Process_Sequence}-${index}`}>
          <td>{plan.Journey_ID || '—'}</td><td><b>{plan.Order_ID || '—'}</b></td><td>{plan.Process_Sequence ?? '—'}</td><td>{plan.Process_Name || '—'}</td><td>{plan.Machine_ID || '—'}</td><td>{plan.Planned_Qty ?? 0}</td><td>{plan.Completed_Qty ?? 0}</td><td>{plan.Pending_Qty ?? 0}</td><td><span className="machine-status">{plan.Process_Status || 'Planned'}</span></td>
        </tr>)}</tbody>
      </table>
      {processJourneyLoading && <div className="empty-state">Loading production plans...</div>}
      {!processJourneyLoading && processJourneys.length === 0 && <div className="empty-state">No production plans saved yet. Create the first plan above.</div>}
    </div>
  </section>
)}
</>}
{managerPage === 'phase3-capacity' && <Phase3CapacityWorkspace role={role} email={email} orders={orders} />}
<div className={`manager-machine-page${managerPage === 'machine-management' ? '' : ' is-hidden'}`}><ManagerMachineSetup machines={machines} setMachines={setMachines} targets={targets} setTargets={setTargets} machineSyncState={machineSyncState} setMachineSyncState={setMachineSyncState} /></div>




    <footer className="dashboard-footer">KINETIC GEARS · NAGPUR <span>PRODUCTION MONITORING SYSTEM</span><span className="local-note">{machineSyncState === 'loaded' ? 'Machine Master list loaded from Google Sheets.' : machineSyncState === 'loading' ? 'Loading Machine Master from Google Sheets.' : 'Machine Master could not be confirmed from Google Sheets; local demo data may be shown.'} Machine targets persist in this browser; production entries are also sent to the configured endpoint.</span></footer></main></div>



}







function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={`field${wide ? ' field-wide' : ''}`}><span>{label}</span>{children}</label> }



function ManagerMachineSetup({ machines, setMachines, targets, setTargets, machineSyncState, setMachineSyncState }: { machines: Machine[]; setMachines: React.Dispatch<React.SetStateAction<Machine[]>>; targets: MachineTarget[]; setTargets: React.Dispatch<React.SetStateAction<MachineTarget[]>>; machineSyncState: 'loading' | 'loaded' | 'error'; setMachineSyncState: React.Dispatch<React.SetStateAction<'loading' | 'loaded' | 'error'>> }) {



  const [targetDate, setTargetDate] = useState(todayDate())

  const [assignedSupervisor, setAssignedSupervisor] = useState('')



  const [targetMachine, setTargetMachine] = useState('')



  const [targetQuantity, setTargetQuantity] = useState('')



  const [editingTarget, setEditingTarget] = useState<string | null>(null)



  const [machineForm, setMachineForm] = useState<Machine>({ id: '', name: '', type: '', status: 'Active', remarks: '' })



  const [editingMachine, setEditingMachine] = useState<string | null>(null)



  const [machineSearch, setMachineSearch] = useState('')



  const [statusFilter, setStatusFilter] = useState('All statuses')



  const [targetSearch, setTargetSearch] = useState('')



  const [targetFilterDate, setTargetFilterDate] = useState('')



  const filteredTargets = targets.filter((target) => (!targetFilterDate || target.date === targetFilterDate) && (!targetSearch || `${target.date} ${target.machineId}`.toLowerCase().includes(targetSearch.toLowerCase())))



  const filteredMachines = machines.filter((machine) => (statusFilter === 'All statuses' || machine.status === statusFilter) && `${machine.id} ${machine.name} ${machine.type} ${machine.remarks}`.toLowerCase().includes(machineSearch.toLowerCase()))







  async function saveTarget(event: React.FormEvent<HTMLFormElement>) {



    event.preventDefault()







    const quantity = Number(targetQuantity)







    if (!targetMachine || !targetDate || !Number.isFinite(quantity) || quantity < 0) {



      window.alert('Please enter a valid date, machine and target quantity.')



      return



    }







    // Editing existing targets is not supported by the current backend route.



    if (editingTarget) {



      window.alert('Backend update support is not configured yet. Please add a new target for now.')



      return



    }







    const payload = {



      action: 'saveMachineTarget',



      Target_Date: targetDate,

      Assigned_Supervisor_Email: assignedSupervisor,



      Machine_ID: targetMachine,



      Target_Qty: quantity,



      Remarks: '',



      Created_By: 'Manager'



    }







    try {



      const response = await fetch(API_URL, {



        method: 'POST',



        headers: {



          'Content-Type': 'text/plain;charset=utf-8'



        },



        body: JSON.stringify(payload)



      })







      if (!response.ok) {



        throw new Error(`Server returned HTTP ${response.status}`)



      }







      const result = await response.json()







      if (result.success !== true) {



        throw new Error(result.message || 'Backend did not confirm the target save.')



      }







      const savedTarget: MachineTarget = {



        id: result.targetId,



        date: targetDate,

        assignedSupervisor,



        machineId: targetMachine,



        quantity,



        unit: 'Nos'



      }







      setTargets(current => [savedTarget, ...current])



      setEditingTarget(null)

      setTargetQuantity('')

      setAssignedSupervisor('')







      window.alert('Machine target saved successfully.')







    } catch (error) {



      const message = error instanceof Error ? error.message : 'Unknown error'



      window.alert(`Unable to save machine target: ${message}`)



    }



  }















  function clearMachineForm() { setMachineForm({ id: '', name: '', type: '', status: 'Active', remarks: '' }); setEditingMachine(null) }



  async function saveMachine(event: React.FormEvent<HTMLFormElement>) {



    event.preventDefault()



    const record = { ...machineForm, id: machineForm.id.trim(), name: machineForm.name.trim(), remarks: machineForm.remarks.trim() }



    if (!record.id || !record.name) return



    if (machines.some((machine) => machine.id.toLowerCase() === record.id.toLowerCase() && machine.id !== editingMachine)) { window.alert('A machine with this ID already exists.'); return }



    try {

      const response = await fetch(`${API_URL}?action=saveMachine`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'saveMachine', Machine_ID: record.id, Machine_Name: record.name, Department: record.type, Active_Status: record.status }) })

      const responseBody = await response.text()

      let result: Record<string, unknown>

      try {

        const parsed: unknown = JSON.parse(responseBody)

        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response')

        result = parsed as Record<string, unknown>

      } catch {

        const detail = responseBody.trim() || `Server returned HTTP ${response.status} without an error message.`

        throw new Error(detail)

      }

      if (!response.ok || result.success !== true) {

        const backendError = result.error ?? result.errorMessage ?? result.message

        throw new Error(typeof backendError === 'string' && backendError.trim() ? backendError : `Server returned HTTP ${response.status} without an error message.`)

      }

      setMachines((current) => editingMachine ? current.map((machine) => machine.id === editingMachine ? record : machine) : [...current, record])

      clearMachineForm()

      try {

        const refreshedMachines = await fetchBackendMachines()

        setMachines(refreshedMachines)

        setMachineSyncState('loaded')

        window.alert('Machine saved successfully to Google Sheets.')

      } catch (refreshError) {

        setMachineSyncState('error')

        const detail = refreshError instanceof Error ? refreshError.message : 'Unknown error'

        window.alert(`Machine was saved to Google Sheets, but the list could not be refreshed: ${detail}`)

      }

    } catch (error) {

      const message = error instanceof Error ? error.message : 'Unknown error'

      window.alert(`Unable to save machine to Google Sheets: ${message}`)

    }



  }



  return <div className="manager-machine-setup">



    <section className="surface manager-config-card"><div className="section-heading"><div><span className="section-index">02</span><div><h2>Machine Targets</h2><p>Set production targets by machine and date</p></div></div><span className="draft-label">SAVED IN THIS BROWSER</span></div>



      <form className="entry-form" onSubmit={saveTarget}><div className="form-grid target-form-grid"><Field label="Target Date"><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} required /></Field><Field label="Machine"><select value={targetMachine} onChange={(event) => setTargetMachine(event.target.value)} required><option value="">Select machine</option>{machines.filter((machine) => machine.status === 'Active').map((machine) => <option key={machine.id} value={machine.id}>{machine.id} — {machine.name}</option>)}</select></Field><Field label="Assigned Supervisor"><select value={assignedSupervisor} onChange={(event) => setAssignedSupervisor(event.target.value)} required><option value="">Select Supervisor</option>{demoAccounts.filter((account) => account.role === 'Supervisor').map((account) => <option key={account.email} value={account.email}>{account.email}</option>)}</select></Field><Field label="Target Quantity"><input type="number" min="0" value={targetQuantity} onChange={(event) => setTargetQuantity(event.target.value)} placeholder="0" required /></Field><div className="target-submit"><button className="primary-button save-button" type="submit">{editingTarget ? 'Update Target' : 'Save Target'}</button></div></div></form>



      <div className="manager-table-tools"><input aria-label="Search targets" placeholder="Search targets" value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} /><label>Date filter<input type="date" value={targetFilterDate} onChange={(event) => setTargetFilterDate(event.target.value)} /></label></div>



      <div className="table-wrap"><table><thead><tr><th>Target Date</th><th>Machine ID</th><th>Machine Name</th><th>Assigned Supervisor</th><th>Target Quantity</th><th>Actions</th></tr></thead><tbody>{filteredTargets.map((target) => <tr key={target.id}><td>{target.date}</td><td><b>{target.machineId}</b></td><td>{machines.find((machine) => machine.id === target.machineId)?.name ?? 'Machine unavailable'}</td><td>{target.assignedSupervisor || '—'}</td><td>{target.quantity} {target.unit ?? 'Nos'}</td><td className="table-actions"><button type="button" onClick={() => { setEditingTarget(target.id); setTargetDate(target.date); setAssignedSupervisor(target.assignedSupervisor || ''); setTargetMachine(target.machineId); setTargetQuantity(String(target.quantity)) }}>Edit</button><button type="button" className="danger-action" onClick={() => setTargets((current) => current.filter((item) => item.id !== target.id))}>Delete</button></td></tr>)}</tbody></table>{filteredTargets.length === 0 && <div className="empty-state">No saved targets match the selected filters.</div>}</div>



    </section>



    <section className="manager-master-title"><div><span className="section-index">03</span><div><h2>Machine Master</h2><p>Manage the machines available for production planning</p></div></div><span className="draft-label">{machineSyncState === 'loaded' ? 'GOOGLE SHEETS' : machineSyncState === 'loading' ? 'LOADING SHEETS' : 'SHEETS UNAVAILABLE · LOCAL DATA'}</span></section>



    <section className="surface manager-config-card"><div className="section-heading"><div><span className="section-index">A</span><div><h2>{editingMachine ? 'Edit Machine' : 'Add New Machine'}</h2><p>Enter machine details</p></div></div></div>



      <form className="entry-form" onSubmit={saveMachine}><div className="form-grid"><Field label="Machine ID"><input value={machineForm.id} onChange={(event) => setMachineForm({ ...machineForm, id: event.target.value })} placeholder="Machine ID" required disabled={!!editingMachine} /></Field><Field label="Machine Name"><input value={machineForm.name} onChange={(event) => setMachineForm({ ...machineForm, name: event.target.value })} placeholder="Machine name" required /></Field><Field label="Machine Type"><select value={machineForm.type} onChange={(event) => setMachineForm({ ...machineForm, type: event.target.value })} required><option value="">Select type</option>{['CNC Turning', 'Gear Hobbing', 'Gear Shaping', 'Gear Grinding', 'Machining', 'Drilling', 'Heat Treatment', 'Quality Inspection', 'CNC', 'Lathe', 'Milling', 'Grinding', 'Other'].map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Status"><select value={machineForm.status} onChange={(event) => setMachineForm({ ...machineForm, status: event.target.value as Machine['status'] })}><option>Active</option><option>Maintenance</option><option>Inactive</option></select></Field><Field label="Remarks" wide><input value={machineForm.remarks} onChange={(event) => setMachineForm({ ...machineForm, remarks: event.target.value })} placeholder="Optional remarks" /></Field></div><div className="form-actions machine-form-actions"><span>{machineSyncState === 'loaded' ? 'Machine Master list is loaded from Google Sheets.' : machineSyncState === 'loading' ? 'Loading Machine Master from Google Sheets...' : 'Google Sheets unavailable; displayed machines may be browser demo data.'}</span><div><button className="secondary-button" type="button" onClick={clearMachineForm}>Clear</button><button className="primary-button save-button" type="submit">{editingMachine ? 'Update Machine' : 'Add Machine'}</button></div></div></form>



    </section>



    <section className="surface manager-config-card"><div className="section-heading"><div><span className="section-index">B</span><div><h2>Machine List</h2><p>{filteredMachines.length} machines</p></div></div></div><div className="manager-table-tools"><input aria-label="Search machines" placeholder="Search machine ID, name, type, remarks" value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} /><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>Active</option><option>Maintenance</option><option>Inactive</option></select></label></div><div className="table-wrap"><table><thead><tr><th>Machine ID</th><th>Machine Name</th><th>Machine Type</th><th>Status</th><th>Remarks</th><th>Actions</th></tr></thead><tbody>{filteredMachines.map((machine) => <tr key={machine.id}><td><b>{machine.id}</b></td><td>{machine.name}</td><td>{machine.type}</td><td><span className={`machine-status ${machine.status.toLowerCase()}`}>{machine.status}</span></td><td>{machine.remarks || '—'}</td><td className="table-actions"><button type="button" onClick={() => { setEditingMachine(machine.id); setMachineForm(machine) }}>Edit</button><button type="button" className="danger-action" onClick={() => { setMachines((current) => current.filter((item) => item.id !== machine.id)); setTargets((current) => current.filter((target) => target.machineId !== machine.id)); if (editingMachine === machine.id) clearMachineForm() }}>Delete</button></td></tr>)}</tbody></table>{filteredMachines.length === 0 && <div className="empty-state">No saved machines match the selected filters.</div>}</div></section>



  </div>



}



function EntryTable({ entries }: { entries: Entry[] }) {



  return <div className="table-wrap"><table><thead><tr><th>Date</th><th>Shift</th><th>Machine</th><th>Product</th><th>Target</th><th>Actual</th><th>Good</th><th>Rejected</th><th>Shortfall Qty.</th><th>Shortfall Reason</th><th>Rejection Reason</th></tr></thead><tbody>{entries.map((e, i) => { const shortfall = Math.max(0, e.target - e.actual); const rejectionReason = e.rejectionReason || ''; return <tr key={e.machine + '-' + i}><td>{new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td><td><span className="shift-pill">{e.shift}</span></td><td><b>{e.machine}</b></td><td>{e.product}</td><td>{e.target}</td><td>{e.actual}</td><td className="good-cell">{e.good}</td><td className={e.rejected ? 'reject-cell' : ''}>{e.rejected}</td><td>{shortfall > 0 ? shortfall : '—'}</td><td>{shortfall > 0 ? (e.shortfallReason || '—') : '—'}</td><td>{e.rejected > 0 ? (rejectionReason || '—') : '—'}</td></tr>})}</tbody></table>{entries.length === 0 && <div className="empty-state">No entries yet. Add your first production entry above.</div>}</div>



}







export default App

// Phase 2 is kept inside this factory so Phase 1 and Phase 2 declarations remain isolated
// while both live in this single App.tsx file.
function createPhase2Workspace() {










const API_URL = 'https://script.google.com/macros/s/AKfycbx2l-R4qea9DvppWGhbCSC15zjtpJM7FBHWiC3eYUkN34tuwo4nIS059VcdWwm_Mivlag/exec'



type Role = 'Supervisor' | 'Manager'

type OrderRecord = {
  orderId: string;
  orderDate: string;
  productName: string;
  partNumber: string;
  orderQuantity: number;
  materialSpecification: string;
  deliveryDate: string;
  priority: string;
  status: string;
  remarks: string;
};

type OrderFormState = {
  orderDate: string;
  productName: string;
  partNumber: string;
  orderQuantity: string;
  materialSpecification: string;
  deliveryDate: string;
  priority: string;
  remarks: string;
};

const emptyOrderForm: OrderFormState = {
  orderDate: new Date().toISOString().slice(0, 10),
  productName: '',
  partNumber: '',
  orderQuantity: '',
  materialSpecification: '',
  deliveryDate: '',
  priority: 'Normal',
  remarks: '',
};

async function fetchBackendOrders(): Promise<OrderRecord[]> {
  const url = `${API_URL}?action=orders`;
  const response = await fetch(url, { method: 'GET', redirect: 'follow' });
  const responseText = await response.text();
  let result: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response');
    result = parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Orders endpoint returned an unreadable response: ${responseText.trim() || 'empty response'}`);
  }
  if (!response.ok || result.success !== true || !Array.isArray(result.orders)) {
    throw new Error(String(result.message ?? result.error ?? `Orders request failed (HTTP ${response.status})`));
  }
  return result.orders.map((row: Record<string, unknown>) => ({
    orderId: String(row['Order ID'] ?? row.Order_ID ?? row.orderId ?? ''),
    orderDate: normalizeSheetDate(row['Order Date'] ?? row.Order_Date ?? row.orderDate),
    productName: String(row['Product Name'] ?? row.Product_Name ?? row.productName ?? ''),
    partNumber: String(row['Part Number'] ?? row.Part_Number ?? row.partNumber ?? ''),
    orderQuantity: Number(row['Order Quantity'] ?? row.Order_Quantity ?? row.orderQuantity ?? 0),
    materialSpecification: String(row['Material Specification'] ?? row.Material_Specification ?? row.Material ?? row.materialSpecification ?? ''),
    deliveryDate: normalizeSheetDate(row['Delivery Date'] ?? row.Delivery_Date ?? row.deliveryDate),
    priority: String(row.Priority ?? 'Normal'),
    status: String(row['Order Status'] ?? row.Status ?? row.status ?? 'Registered'),
    remarks: String(row.Remarks ?? row.remarks ?? ''),
  })).filter((order: OrderRecord) => order.orderId);
}

type ProblemStatus = 'Pending' | 'In Progress' | 'Resolved'



type Entry = { recordId?: string; orderId?: string; date: string; shift: string; machine: string; product: string; target: number; actual: number; good: number; rejected: number; reason: string; remarks: string; shortfallReason?: string; rejectionReason?: string }



type Machine = { id: string; name: string; type: string; status: 'Active' | 'Maintenance' | 'Inactive'; remarks: string }



type MachineTarget = { id: string; date: string; machineId: string; quantity: number; unit?: string }


type ProblemLogEntry = {
  productionDate: string;
  machineName: string;
  shift: string;
  problemType: 'Shortfall' | 'Rejection';
  shortfallReason: string;
  status: ProblemStatus;
};

async function fetchBackendTargets(): Promise<MachineTarget[]> {
  const url = `${API_URL}?action=targets`
  const response = await fetch(url, { method: 'GET', redirect: 'follow' })
  const responseText = await response.text()

  let result: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(responseText)
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response')
    result = parsed as Record<string, unknown>
  } catch {
    throw new Error(`GET ${url} returned HTTP ${response.status}: ${responseText.trim() || 'unreadable response'}`)
  }

  if (!response.ok || result.success !== true || !Array.isArray(result.targets)) {
    const backendError = result.error ?? result.message
    const detail = typeof backendError === 'string' && backendError.trim() ? `: ${backendError}` : ''
    throw new Error(`GET ${url} failed with HTTP ${response.status}${detail}`)
  }

  return result.targets.map((row: Record<string, unknown>) => ({
    id: String(row.Target_ID ?? row.TargetId ?? row.ID ?? row.id ?? '').trim(),
    date: normalizeSheetDate(row.Target_Date ?? row.TargetDate ?? row.date),
    machineId: String(row.Machine_ID ?? row.MachineId ?? row.machineId ?? '').trim(),
    quantity: Number(row.Target_Qty ?? row.TargetQty ?? row.quantity ?? 0),
    unit: 'Nos',
  })).filter((target: MachineTarget) => target.id && target.date && target.machineId)
}

async function fetchBackendEntries(): Promise<Entry[]> {

  const url = `${API_URL}?action=records`

  const response = await fetch(url, { method: 'GET', redirect: 'follow' })

  const responseText = await response.text()

  let result: Record<string, unknown>

  try {

    const parsed: unknown = JSON.parse(responseText)

    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response')

    result = parsed as Record<string, unknown>

  } catch {

    throw new Error(`GET ${url} returned HTTP ${response.status}: ${responseText.trim() || 'unreadable response'}`)

  }

  if (!response.ok || result.success !== true || !Array.isArray(result.records)) {

    const backendError = result.error ?? result.message

    const detail = typeof backendError === 'string' && backendError.trim() ? `: ${backendError}` : ''

    throw new Error(`GET ${url} failed with HTTP ${response.status}${detail}`)

  }



  return result.records.map((row: Record<string, unknown>) => {

    const actual = Number(row.Actual_Qty ?? 0)

    const rejected = Number(row.Rejected_Qty ?? 0)

    const remark = String(row.Remarks ?? '')

    const reason = String(row.Rejection_Reason ?? row.RejectionReason ?? remark)

    return {

      orderId: String(row.Order_ID ?? '').trim(),

      recordId: String(row.Record_ID ?? '').trim() || undefined,

      date: normalizeSheetDate(row.Production_Date),

      shift: String(row.Shift ?? ''),

      machine: String(row.Machine_ID ?? ''),

      product: String(row.Product_Part ?? ''),

      target: Number(row.Target_Qty ?? 0),

      actual,

      good: Number(row.Good_Qty ?? Math.max(0, actual - rejected)),

      rejected,

      reason: String(row.Reason ?? remark),

      remarks: remark,

      shortfallReason: String(row.Shortfall_Reason ?? row.ShortfallReason ?? ''),

      rejectionReason: rejected > 0 ? reason : '',

    }

  })

}



const demoAccounts = [{ role: 'Supervisor' as const, email: 'supervisor@kg.com', password: '1234' }, { role: 'Manager' as const, email: 'manager@kg.com', password: '1234' }]



const initialEntries: Entry[] = []



const entriesStorageKey = 'kinetic-gears-production-entries'



const machinesStorageKey = 'kinetic-gears-machines'



const targetsStorageKey = 'kinetic-gears-machine-targets'



const demoSeededStorageKey = 'kinetic-gears-demo-seed-v1'



const demoMachines: Machine[] = [



  { id: 'MCH-001', name: 'CNC Turning Machine 01', type: 'CNC Turning', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-002', name: 'CNC Turning Machine 02', type: 'CNC Turning', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-003', name: 'CNC Gear Hobbing Machine 01', type: 'Gear Hobbing', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-004', name: 'CNC Gear Hobbing Machine 02', type: 'Gear Hobbing', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-005', name: 'Gear Shaping Machine 01', type: 'Gear Shaping', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-006', name: 'Gear Grinding Machine 01', type: 'Gear Grinding', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-007', name: 'VMC Machine 01', type: 'Machining', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-008', name: 'Drilling Machine 01', type: 'Drilling', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-009', name: 'Induction Hardening Machine 01', type: 'Heat Treatment', status: 'Active', remarks: 'Demo sample machine' },



  { id: 'MCH-010', name: 'Gear Inspection Station 01', type: 'Quality Inspection', status: 'Active', remarks: 'Demo sample machine' },



]



const demoDailyTargets = [250, 220, 180, 180, 200, 150, 160, 300, 240, 400]

async function fetchBackendProblems(): Promise<ProblemLogEntry[]> {
  const response = await fetch(`${API_URL}?action=problemLog`, {
    method: 'GET',
    redirect: 'follow',
  });

  const result = await response.json();

  if (!response.ok || result.success !== true || !Array.isArray(result.problems)) {
    throw new Error(result.error || 'Unable to load Problem Log');
  }

  return result.problems;
}





function todayDate() {



  const now = new Date()



  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`



}



function normalizeSheetDate(value: unknown): string {

  const raw = String(value ?? '').trim()

  if (!raw) return ''

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)

  if (match) {

    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`

  }

  return raw

}









function loadStored<T>(key: string): T[] {



  try {



    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')



    return Array.isArray(value) ? value as T[] : []



  } catch { return [] }



}



async function fetchBackendMachines(): Promise<Machine[]> {

  const response = await fetch(`${API_URL}?action=machines`, { method: 'GET', redirect: 'follow' })

  const responseBody = await response.text()

  let result: Record<string, unknown>

  try {

    const parsed: unknown = JSON.parse(responseBody)

    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response')

    result = parsed as Record<string, unknown>

  } catch {

    throw new Error(responseBody.trim() || `Server returned HTTP ${response.status} without an error message.`)

  }

  if (!response.ok || result.success !== true || !Array.isArray(result.machines)) {

    const backendError = result.error ?? result.errorMessage ?? result.message

    throw new Error(typeof backendError === 'string' && backendError.trim() ? backendError : `Server returned HTTP ${response.status} with an invalid machine list.`)

  }



  const records: Machine[] = result.machines.map((row: Record<string, unknown>) => {

    const statusValue = String(row.Active_Status ?? 'Inactive').trim()

    const status: Machine['status'] = statusValue === 'Active' || statusValue === 'Maintenance' ? statusValue : 'Inactive'

    return { id: String(row.Machine_ID ?? '').trim(), name: String(row.Machine_Name ?? '').trim(), type: String(row.Department ?? '').trim(), status, remarks: String(row.Remarks ?? '').trim() }

  }).filter((machine: Machine) => machine.id && machine.name)



  return records.filter((machine, index) => records.findIndex((record) => record.id.toLowerCase() === machine.id.toLowerCase()) === index)

}







function seedDemoData() {



  try {



    if (window.localStorage.getItem(demoSeededStorageKey) === 'true') return



    const machines = loadStored<Machine>(machinesStorageKey)



    const targets = loadStored<MachineTarget>(targetsStorageKey)



    const seededMachines = [...machines, ...demoMachines.filter((sample) => !machines.some((machine) => machine.id.toLowerCase() === sample.id.toLowerCase()))]



    const date = todayDate()



    const seededTargets = [...targets, ...demoMachines.flatMap((machine, index) => targets.some((target) => target.machineId === machine.id && target.date === date) ? [] : [{ id: `demo-${machine.id}-${date}`, date, machineId: machine.id, quantity: demoDailyTargets[index], unit: 'Nos' }])]



    window.localStorage.setItem(machinesStorageKey, JSON.stringify(seededMachines))



    window.localStorage.setItem(targetsStorageKey, JSON.stringify(seededTargets))



    window.localStorage.setItem(demoSeededStorageKey, 'true')



  } catch {



    // Continue with the records available in memory if browser storage is unavailable.



  }



}







seedDemoData()







function loadEntries(): Entry[] {



  try {



    const savedEntries = window.localStorage.getItem(entriesStorageKey)



    if (!savedEntries) return initialEntries



    const parsedEntries: unknown = JSON.parse(savedEntries)



    return Array.isArray(parsedEntries) ? parsedEntries as Entry[] : initialEntries



  } catch {



    return initialEntries



  }



}



const icon = (name: string) => {



  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }



  const paths: Record<string, React.ReactNode> = {



    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>, lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></>, arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>, grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>, factory: <><path d="M3 21V9l6 3V8l6 4V5h6v16Z"/><path d="M7 17h2m3 0h2m3 0h2"/></>, check: <><path d="m5 12 4 4L19 6"/></>, chart: <><path d="M3 3v18h18M8 16v-4m5 4V7m5 9v-7"/></>, logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>, gear: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.2.9-1.3 2.3-1.4-.6a8 8 0 0 1-1.5.9l-.2 1.5h-2.7l-.2-1.5a8 8 0 0 1-1.5-.9l-1.4.6-1.3-2.3 1.2-.9a7 7 0 0 1 0-1.8l-1.2-.9 1.3-2.3 1.4.6a8 8 0 0 1 1.5-.9l.2-1.5h2.7l.2 1.5a8 8 0 0 1 1.5.9l1.4-.6 1.3 2.3-1.2.9a7 7 0 0 1 0 1.8Z"/></>, eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>, eyeoff: <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.3 3.5-.7"/></>, production: <><path d="M4 19V9l5 3V8l5 4V5h6v14Z"/><path d="M8 16h.01M12 16h.01M16 16h.01"/></>, quality: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>, performance: <><path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/></> }



  return <svg {...common}>{paths[name] ?? paths.gear}</svg>



}








const QUALITY_REJECTION_REASONS = [
  'Dimensional Issue', 'Surface Defect', 'Wrong Size', 'Material Defect',
  'Crack / Breakage', 'Hardness Issue', 'Burr / Sharp Edge',
  'Porosity / Casting Defect', 'Machine Setting Issue', 'Other',
];

const MANUFACTURING_PROCESS_OPTIONS = [
  'Raw Material Cutting', 'Turning', 'Facing', 'Drilling', 'Boring',
  'Milling', 'Gear Hobbing', 'Gear Shaping', 'Broaching', 'Heat Treatment',
  'Grinding', 'Gear Grinding', 'Deburring', 'Finishing', 'Quality Inspection',
  'Final Inspection', 'Packing', 'Other',
];

type QualityRecord = {
  Quality_ID?: string; Order_ID: string; Production_ID: string; Inspection_Date: string;
  Inspected_Qty: number; Accepted_Qty: number; Rejected_Qty: number; Rework_Qty: number;
  Rework_Status: string; Rework_Completed_Qty: number; Rejection_Reason: string; Remarks: string;
};
type DispatchRecord = { Dispatch_ID?: string; Order_ID: string; Dispatch_Date: string; Dispatch_Qty: number; Remarks: string };

type Phase2WorkspaceProps = { initialRole: Role; initialEmail: string; onExit: () => void };

function Phase2Workspace({ initialRole, initialEmail, onExit }: Phase2WorkspaceProps) {



  const [role, setRole] = useState<Role | null>(initialRole)



const [managerPage, setManagerPage] = useState<
  'quality-rework' | 'dispatch-tracking'
>('quality-rework')

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [orderForm, setOrderForm] = useState<OrderFormState>(emptyOrderForm);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderMessage, setOrderMessage] = useState('');
  const [orderError, setOrderError] = useState('');
  const [qualityRecords, setQualityRecords] = useState<QualityRecord[]>([]);
  const [dispatchRecords, setDispatchRecords] = useState<DispatchRecord[]>([]);
  const [qualityForm, setQualityForm] = useState({ orderId: '', productionId: '', inspectionDate: todayDate(), inspectedQty: '', acceptedQty: '', rejectedQty: '0', reworkQty: '0', reworkStatus: 'Not Required', reworkCompletedQty: '0', rejectionReason: '', remarks: '' });
  const [dispatchForm, setDispatchForm] = useState({ orderId: '', dispatchDate: todayDate(), dispatchQty: '', remarks: '' });
  // Keep Quality and Dispatch UI state independent so one module's response
  // or status message cannot overwrite the other module.
  const [qualityLoading, setQualityLoading] = useState(false);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [qualitySaving, setQualitySaving] = useState(false);
  const [dispatchSaving, setDispatchSaving] = useState(false);
  const [qualityMessage, setQualityMessage] = useState('');
  const [qualityError, setQualityError] = useState('');
  const [dispatchMessage, setDispatchMessage] = useState('');
  const [dispatchError, setDispatchError] = useState('');



  const [email, setEmail] = useState(initialEmail)



  const [password, setPassword] = useState('')



  const [showPassword, setShowPassword] = useState(false)



  const [loginMessage, setLoginMessage] = useState('')

  useEffect(() => {
    let cancelled = false;
    async function loadOrders() {
      setOrdersLoading(true);
      try {
        const data = await fetchBackendOrders();
        if (!cancelled) setOrders(data);
      } catch (error) {
        console.error('Unable to load orders from Google Sheets:', error);
        if (!cancelled) setOrderError(error instanceof Error ? error.message : 'Unable to load orders.');
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    }
    void loadOrders();
    return () => { cancelled = true; };

  }, []);

  useEffect(() => {
    if (role !== 'Manager' || (managerPage !== 'quality-rework' && managerPage !== 'dispatch-tracking')) return;
    let cancelled = false;

    // Fetch each list independently: a Dispatch endpoint failure must not block
    // Quality records (and vice versa).
    async function loadQualityRecords() {
      setQualityLoading(true);
      setQualityError('');
      try {
        const response = await fetch(`${API_URL}?action=qualityRecords`, { method: 'GET', redirect: 'follow' });
        const body = await response.text();
        let result: { success?: boolean; records?: QualityRecord[]; error?: string; message?: string };
        try { result = JSON.parse(body) as typeof result; }
        catch { throw new Error(`Quality records endpoint returned unreadable data: ${body.trim() || `HTTP ${response.status}`}`); }
        if (!response.ok || result.success !== true || !Array.isArray(result.records)) {
          throw new Error(result.error || result.message || `Could not load Quality/Rework records (HTTP ${response.status}).`);
        }
        if (!cancelled) setQualityRecords([...result.records].sort((a, b) => { const dateDiff = String(b.Inspection_Date || '').localeCompare(String(a.Inspection_Date || '')); return dateDiff || String(b.Quality_ID || '').localeCompare(String(a.Quality_ID || '')); }));
      } catch (error) {
        if (!cancelled) setQualityError(error instanceof Error ? error.message : 'Could not load Quality/Rework records.');
      } finally {
        if (!cancelled) setQualityLoading(false);
      }
    }

    async function loadDispatchRecords() {
      setDispatchLoading(true);
      setDispatchError('');
      try {
        const response = await fetch(`${API_URL}?action=dispatchRecords`, { method: 'GET', redirect: 'follow' });
        const body = await response.text();
        let result: { success?: boolean; records?: DispatchRecord[]; error?: string; message?: string };
        try { result = JSON.parse(body) as typeof result; }
        catch { throw new Error(`Dispatch records endpoint returned unreadable data: ${body.trim() || `HTTP ${response.status}`}`); }
        if (!response.ok || result.success !== true || !Array.isArray(result.records)) {
          throw new Error(result.error || result.message || `Could not load Dispatch records (HTTP ${response.status}).`);
        }
        if (!cancelled) setDispatchRecords(result.records);
      } catch (error) {
        if (!cancelled) setDispatchError(error instanceof Error ? error.message : 'Could not load Dispatch records.');
      } finally {
        if (!cancelled) setDispatchLoading(false);
      }
    }

    void loadQualityRecords();
    void loadDispatchRecords();
    return () => { cancelled = true; };
  }, [role, managerPage]);

  async function saveOrderForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrderSaving(true);
    setOrderMessage('');
    setOrderError('');
    const quantity = Number(orderForm.orderQuantity);
    const missingFields: string[] = [];
    if (!orderForm.orderDate.trim()) missingFields.push('Order Date');
    if (!orderForm.productName.trim()) missingFields.push('Product Name');
    if (!Number.isFinite(quantity) || quantity <= 0) missingFields.push('Order Quantity (must be greater than 0)');
    if (!orderForm.deliveryDate.trim()) missingFields.push('Delivery Date');
    if (missingFields.length > 0) {
      setOrderError(`Please check required fields: ${missingFields.join(', ')}`);
      setOrderSaving(false);
      return;
    }
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveOrder',
          data: {
            orderDate: orderForm.orderDate,
            // Customer name is intentionally not displayed in this workspace.
            customerName: 'Confidential',
            productName: orderForm.productName.trim(),
            partNumber: orderForm.partNumber.trim(),
            orderQuantity: quantity,
            materialSpecification: orderForm.materialSpecification.trim(),
            deliveryDate: orderForm.deliveryDate,
            priority: orderForm.priority,
            remarks: orderForm.remarks.trim(),
          },
        }),
      });
      const responseText = await response.text();
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        throw new Error(`Save order returned an unreadable response: ${responseText.trim() || 'empty response'}`);
      }
      if (!response.ok || result.success !== true) {
        const backendMessage = result.message ?? result.error ?? result.details;
        throw new Error(
          `Backend rejected the order (HTTP ${response.status}): ${String(backendMessage ?? 'No error details returned')}`
        );
      }
      const updatedOrders = await fetchBackendOrders();
      setOrders(updatedOrders);
      setOrderForm({ ...emptyOrderForm, orderDate: new Date().toISOString().slice(0, 10) });
      setOrderMessage('Order saved successfully.');
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : 'Unable to save order.');
    } finally {
      setOrderSaving(false);
    }
  }




  const [entries, setEntries] = useState<Entry[]>(loadEntries)

  const entriesLoadVersion = useRef(0)



  // Load production history from Apps Script on page load.

  useEffect(() => {

    let cancelled = false



    async function loadBackendEntries() {

      try {

        const versionAtRequest = entriesLoadVersion.current

        const records = await fetchBackendEntries()

        if (!cancelled && versionAtRequest === entriesLoadVersion.current) setEntries(records)

      } catch (error) {

        console.error('Unable to load production records from backend:', error)

        if (!cancelled) {

          const detail = error instanceof Error ? error.message : 'Unknown error'

          window.alert(`Unable to load production records: ${detail}`)

        }

      }

    }



    void loadBackendEntries()

    return () => { cancelled = true }

  }, [])



  const [machines, setMachines] = useState<Machine[]>(() => loadStored<Machine>(machinesStorageKey))

  const [machineSyncState, setMachineSyncState] = useState<'loading' | 'loaded' | 'error'>('loading')

useEffect(() => {
  let cancelled = false;

  async function loadProblemLog() {
    try {
      const problems = await fetchBackendProblems();

      if (!cancelled) {
        setProblemLogEntries(problems);
      }
    } catch (error) {
      console.error('Unable to load Problem Log:', error);
    }
  }

  void loadProblemLog();

  return () => {
    cancelled = true;
  };
}, []);

  useEffect(() => {

    let cancelled = false

    async function loadMachines() {

      try {

        const records = await fetchBackendMachines()

        if (!cancelled) { setMachines(records); setMachineSyncState('loaded') }

      } catch (error) {

        console.error('Unable to load machines from Google Sheets:', error)

        if (!cancelled) {

          setMachineSyncState('error')

          const detail = error instanceof Error ? error.message : 'Unknown error'

          window.alert(`Unable to load machines from Google Sheets. Check your internet connection and Apps Script deployment. ${detail}`)

        }

      }

    }

    void loadMachines()

    return () => { cancelled = true }

  }, [])



  const [targets, setTargets] = useState<MachineTarget[]>(() => loadStored<MachineTarget>(targetsStorageKey))

  // Load machine targets from Google Sheets; backend data is the source of truth.
  useEffect(() => {
    let cancelled = false

    async function loadBackendTargetsOnStart() {
      try {
        const records = await fetchBackendTargets()
        if (!cancelled) setTargets(records)
      } catch (error) {
        console.error('Unable to load machine targets from Google Sheets:', error)
        if (!cancelled) {
          const detail = error instanceof Error ? error.message : 'Unknown error'
          window.alert(`Unable to load machine targets from Google Sheets: ${detail}`)
        }
      }
    }

    void loadBackendTargetsOnStart()
    return () => { cancelled = true }
  }, [])




  useEffect(() => {



    try {



      window.localStorage.setItem(entriesStorageKey, JSON.stringify(entries))



    } catch {



      // Keep the in-memory demo usable if browser storage is unavailable.



    }



  }, [entries])



  useEffect(() => { window.localStorage.setItem(machinesStorageKey, JSON.stringify(machines)) }, [machines])



  useEffect(() => { window.localStorage.setItem(targetsStorageKey, JSON.stringify(targets)) }, [targets])



  const openProblems = entries.filter((entry) => entry.rejected > 0).length



  const [filterDate, setFilterDate] = useState('')



  const [filterShift, setFilterShift] = useState('All shifts')



  const [filterMachine, setFilterMachine] = useState('All machines')

  const [problemStatuses, setProblemStatuses] = useState<Record<string, ProblemStatus>>({})
  
  const [problemLogEntries, setProblemLogEntries] = useState<ProblemLogEntry[]>([]); 

  const [problemDateFilter, setProblemDateFilter] = useState('')

  const [problemMachineFilter, setProblemMachineFilter] = useState('All machines')

  const [problemShiftFilter, setProblemShiftFilter] = useState('All shifts')

  const [problemStatusFilter, setProblemStatusFilter] = useState<'All' | ProblemStatus>('All')

  const [problemSearch, setProblemSearch] = useState('')



  const [form, setForm] = useState({ date: todayDate(), shift: 'Morning', machine: '', product: '', orderId: '', actual: '', rejected: '0', reason: '', otherReason: '', shortfallReason: '', shortfallOtherReason: '' })



  const applicableTarget = targets.find((item) => item.machineId === form.machine && item.date === form.date)



  const activeMachines = machines.filter((machine) => machine.status === 'Active')



  const actualQuantity = Number(form.actual || 0)



  const rejectedQuantity = Number(form.rejected || 0)



  const targetQuantity = applicableTarget?.quantity ?? 0



  const shortfallQuantity = Math.max(0, targetQuantity - actualQuantity)



  const showShortfallDetails = !!applicableTarget && form.actual !== '' && actualQuantity < targetQuantity



  const showRejectionDetails = rejectedQuantity > 0



  const good = Math.max(0, actualQuantity - rejectedQuantity)



  const filtered = useMemo(() => entries.filter((e) => (!filterDate || e.date === filterDate) && (filterShift === 'All shifts' || e.shift === filterShift) && (filterMachine === 'All machines' || e.machine === filterMachine)), [entries, filterDate, filterShift, filterMachine])

  const problemRows = problemLogEntries.map((problem) => {
  const entry = {
    date: problem.productionDate,
    shift: problem.shift,
    machine: problem.machineName,
    product: '',
    target: 0,
    actual: 0,
    problemType: problem.problemType,
    shortfallReason: problem.shortfallReason,
  };

  // Include problemType so a Shortfall and Rejection with otherwise identical
  // details cannot share the same UI status key.
  const key = `${problem.productionDate}-${problem.machineName}-${problem.shift}-${problem.problemType}-${problem.shortfallReason}`;

  return {
    entry,
    key,
    status: problemStatuses[key] ?? problem.status,
  };
});

  const problemMachineOptions = Array.from(new Set(problemRows.map(({ entry }) => entry.machine).filter(Boolean)))

  const problemShiftOptions = Array.from(new Set(problemRows.map(({ entry }) => entry.shift).filter(Boolean)))

  const filteredProblemRows = problemRows.filter(({ entry }) =>

    (!problemDateFilter || entry.date === problemDateFilter) &&

    (problemMachineFilter === 'All machines' || entry.machine === problemMachineFilter) &&

    (problemShiftFilter === 'All shifts' || entry.shift === problemShiftFilter) &&

    (!problemSearch.trim() || `${entry.machine} ${machines.find((machine) => machine.id === entry.machine)?.name ?? ''} ${entry.shortfallReason ?? ''}`.toLowerCase().includes(problemSearch.trim().toLowerCase()))

  )

  const visibleProblemRows = filteredProblemRows.filter((row) => problemStatusFilter === 'All' || row.status === problemStatusFilter)

  const problemStatusCounts = visibleProblemRows.reduce((counts, row) => {

    counts[row.status] += 1

    return counts

  }, { Pending: 0, 'In Progress': 0, Resolved: 0 })







  function login(event: React.FormEvent<HTMLFormElement>) {



    event.preventDefault()



    const account = demoAccounts.find((item) => item.email === email.trim().toLowerCase() && item.password === password)



    if (!account) { setLoginMessage('Those demo credentials do not match. Choose a demo account below.'); return }



    setLoginMessage('')



    setRole(account.role)



  }



  function logout() { onExit(); }



  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {



    event.preventDefault()



    const rejected = Number(form.rejected || 0)



    const actual = Number(form.actual)



    const reason = form.reason === 'Other' ? form.otherReason.trim() : form.reason



    const shortfallReason = form.shortfallReason === 'Other' ? form.shortfallOtherReason.trim() : form.shortfallReason



    if (!activeMachines.some((machine) => machine.id === form.machine) || !applicableTarget || rejected > actual || (showRejectionDetails && !reason) || (showShortfallDetails && !shortfallReason)) return



    const payload = {



      Production_Date: form.date,



      Order_ID: form.orderId,



      Shift: form.shift,



      Machine_ID: form.machine,



      Product_Part: form.product.trim(),



      Target_Qty: applicableTarget.quantity,



      Actual_Qty: actual,



      Rejected_Qty: rejected,



      Good_Qty: actual - rejected,



      Remarks: reason || '',



      Supervisor_ID: email.trim().toLowerCase(),



    }







    try {











const response = await fetch(API_URL, {



  method: 'POST',



  headers: {



    'Content-Type': 'text/plain;charset=utf-8',



  },



  body: JSON.stringify(payload),



})











      if (!response.ok) throw new Error(`POST ${API_URL} returned HTTP ${response.status}.`)



      if (response.redirected && /accounts\.google\.com/i.test(response.url)) {



        throw new Error('The Apps Script endpoint redirected to Google sign-in.')



      }







      const responseText = await response.text()



      let result: unknown



      try {



        result = JSON.parse(responseText)



      } catch {



        throw new Error('The backend returned an unreadable response.')



      }



      const confirmation = result as { success?: unknown; status?: unknown }



      if (confirmation.success !== true && confirmation.status !== 'success') {



        throw new Error('The backend did not confirm that the entry was saved.')



      }





// Save shortfall to Problem_Log only when a reason is provided.

      if (showShortfallDetails && shortfallReason) {

        const problemResponse = await fetch(API_URL, {

          method: 'POST',

          headers: {

            'Content-Type': 'text/plain;charset=utf-8',

          },

          body: JSON.stringify({

            action: 'saveProblemLog',

            productionDate: payload.Production_Date,

            machineName:

              activeMachines.find((machine) => machine.id === form.machine)?.name

              || form.machine,

            shift: payload.Shift,

            shortfallReason,

          }),

        })



        if (!problemResponse.ok) {

          throw new Error(

            `Problem Log request returned HTTP ${problemResponse.status}.`

          )

        }



        const problemText = await problemResponse.text()

        let problemResult: { success?: boolean; message?: string }



        try {

          problemResult = JSON.parse(problemText)

        } catch {

          throw new Error('Problem Log returned an unreadable response.')

        }



        if (problemResult.success !== true) {

          throw new Error(

            problemResult.message || 'Problem Log was not saved.'

          )

        }

      }


      // Save rejection to Problem_Log only when a reason is provided.
      if (showRejectionDetails && reason) {
        const rejectionResponse = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
          },
          body: JSON.stringify({
            action: 'saveProblemLog',
            productionDate: payload.Production_Date,
            machineName:
              activeMachines.find((machine) => machine.id === form.machine)?.name
              || form.machine,
            shift: payload.Shift,
            problemType: 'Rejection',
            reason,
          }),
        });

        if (!rejectionResponse.ok) {
          throw new Error(
            `Rejection Problem Log request returned HTTP ${rejectionResponse.status}.`
          );
        }

        const rejectionText = await rejectionResponse.text();
        let rejectionResult: { success?: boolean; message?: string };

        try {
          rejectionResult = JSON.parse(rejectionText);
        } catch {
          throw new Error('Rejection Problem Log returned an unreadable response.');
        }

        if (rejectionResult.success !== true) {
          throw new Error(
            rejectionResult.message || 'Rejection Problem Log was not saved.'
          );
        }
      }


      entriesLoadVersion.current += 1

      const savedEntry: Entry = { orderId: payload.Order_ID, date: payload.Production_Date, shift: payload.Shift, machine: payload.Machine_ID, product: payload.Product_Part, target: payload.Target_Qty, actual: payload.Actual_Qty, good: payload.Good_Qty, rejected: payload.Rejected_Qty, reason: reason || '—', remarks: payload.Remarks, shortfallReason: showShortfallDetails ? shortfallReason : undefined, rejectionReason: showRejectionDetails ? reason : undefined }

      setEntries((current) => [savedEntry, ...current])



      setForm((current) => ({ ...current, product: '', actual: '', rejected: '0', reason: '', otherReason: '', shortfallReason: '', shortfallOtherReason: '' }))



    } catch (error) {



      const message = error instanceof Error ? error.message : 'Unknown network or backend error.'



      window.alert(`Unable to save production entry: ${message}`)



    }



  }







  const managerSums = filtered.reduce((a, e) => ({ target: a.target + e.target, actual: a.actual + e.actual, good: a.good + e.good, rejected: a.rejected + e.rejected }), { target: 0, actual: 0, good: 0, rejected: 0 })



  const managerKpis = [{ label: 'Total Target', value: managerSums.target, meta: 'units planned', color: 'blue' }, { label: 'Total Actual', value: managerSums.actual, meta: 'units produced', color: 'navy' }, { label: 'Good Quantity', value: managerSums.good, meta: 'accepted units', color: 'green' }, { label: 'Rejected Quantity', value: managerSums.rejected, meta: 'units rejected', color: 'red' }, { label: 'Achievement', value: `${managerSums.target ? Math.round(managerSums.actual / managerSums.target * 100) : 0}%`, meta: 'of target achieved', color: 'purple' }, { label: 'Shortfall', value: Math.max(0, managerSums.target - managerSums.actual), meta: 'units to target', color: 'amber' }]







  if (!role) return <main className="login-page"><section className="login-shell">



    <div className="login-panel"><div className="brand"><div className="brand-mark">{icon('gear')}</div><div><strong>Kinetic Gears, Nagpur</strong><span>Production Monitoring System</span></div></div>



      <div className="login-content"><span className="eyebrow">PRODUCTION PORTAL</span><h1>Welcome back</h1><p className="login-intro">Sign in to continue to Production Monitoring</p>



        <form className="login-form" onSubmit={login}><label htmlFor="email">Email address</label><div className="input-wrap">{icon('mail')}<input id="email" type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>



          <label htmlFor="password">Password</label><div className="input-wrap">{icon('lock')}<input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button className="show-password" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{icon(showPassword ? 'eyeoff' : 'eye')}</button></div>



          {loginMessage && <p className="form-message" role="alert">{loginMessage}</p>}<button className="primary-button" type="submit">Login <span>{icon('arrow')}</span></button>



        </form>



      </div>



      <div className="demo-box"><div className="demo-title"><span>DEMO ACCESS</span><small>Select an account to autofill</small></div><div className="demo-cards">{demoAccounts.map((account) => <button className="demo-card" type="button" key={account.role} onClick={() => { setEmail(account.email); setPassword(account.password); setLoginMessage('') }}><span className="demo-avatar">{account.role[0]}</span><span className="demo-info"><strong>{account.role}</strong><small>{account.email}</small><small>Password: 1234</small></span><span className="demo-chevron">{icon('arrow')}</span></button>)}</div></div>



      <p className="login-footnote">Demo interface — Authentication is not connected</p>



    </div>



    <aside className="visual-panel"><div className="visual-photo"/><div className="visual-overlay"/><div className="visual-content"><div className="visual-kicker"><span/> PRECISION IN EVERY SHIFT</div><h2>Production.<br/>Quality.<br/><em>Performance.</em></h2><p className="visual-copy">Clear insight into every part, process, and production line.</p><div className="feature-list"><div>{icon('production')}<span>Track daily production</span></div><div>{icon('quality')}<span>Monitor rejected quantity</span></div><div>{icon('performance')}<span>Review machine performance</span></div></div><div className="visual-caption">ENGINEERED FOR BETTER OUTPUT</div></div><div className="image-credit">KINETIC GEARS · NAGPUR</div></aside>



  </section></main>







// Phase 1's production-entry helpers remain in this embedded source for compatibility, but Phase 2 does not render them.
  void openProblems;
  void shortfallQuantity;
  void good;
  void saveEntry;
  void EntryTable;
  // Legacy Phase 2 dashboard/order-management helpers are intentionally not rendered:
  // Phase 1 owns those screens. Keep their state/helpers inert for source compatibility.
  void ordersLoading;
  void orderSaving;
  void orderMessage;
  void orderError;
  void saveOrderForm;
  void setFilterDate;
  void setFilterShift;
  void setFilterMachine;
  void setProblemStatuses;
  void setProblemDateFilter;
  void setProblemMachineFilter;
  void setProblemShiftFilter;
  void setProblemStatusFilter;
  void setProblemSearch;
  void problemMachineOptions;
  void problemShiftOptions;
  void problemStatusCounts;
  void managerKpis;
  void ManagerMachineSetup;

  const pageTitle =
    role === 'Supervisor'
      ? 'Supervisor Home'
      : managerPage === 'quality-rework'
        ? 'Quality / Rework'
        : managerPage === 'dispatch-tracking'
          ? 'Dispatch Tracking'
          : 'Quality / Rework'


  return <div className="workspace"><aside className="sidebar"><a className="side-brand" href="#home" onClick={(e) => e.preventDefault()}><span className="side-logo">{icon('gear')}</span><span><b>KINETIC GEARS</b><small>PRODUCTION SYSTEM</small></span></a><div className="side-label">WORKSPACE</div><button className="nav-item" type="button" onClick={onExit}>← Back to Phase 1</button>{role === 'Manager' && <>
  <button className={`nav-item${managerPage === 'quality-rework' ? ' active' : ''}`} onClick={() => setManagerPage('quality-rework')}>{icon('quality')}<span>Quality / Rework</span></button>
  <button className={`nav-item${managerPage === 'dispatch-tracking' ? ' active' : ''}`} onClick={() => setManagerPage('dispatch-tracking')}>{icon('production')}<span>Dispatch Tracking</span></button>
</>}{role === 'Supervisor' && <div className="nav-item active">{icon('factory')}<span>Assigned Processes & Daily Tracking</span></div>}<div className="sidebar-bottom"><div className="user-chip"><span className="user-avatar">{role[0]}</span><span><b>{role}</b><small>{email}</small></span></div><button className="logout-button" onClick={logout}>{icon('logout')}<span>Logout</span></button></div></aside>



    <main className="dashboard"><header className="dash-header"><div><div className="breadcrumb">WORKSPACE <span>/</span> {role === 'Supervisor' ? 'SUPERVISOR' : 'MANAGER'}</div><h1>{pageTitle}</h1><p>{role === 'Supervisor' ? 'View assigned processes and record daily progress' : 'Plan and monitor machine processes, quality and dispatch'}</p></div><div className="header-date">{icon('calendar')}<span>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></div></header>



    {role === 'Supervisor' ? <section className="surface records-surface"><div className="empty-state">Supervisor daily production tracking is available on Supervisor Home. Use Back to Phase 1 to return to it.</div></section> : <>{managerPage === 'quality-rework' && <section className="surface records-surface">
  <div className="section-heading"><div><span className="section-index">04</span><div><h2>Quality Inspection & Rework</h2><p>Record inspection results against an order</p></div></div><span className="draft-label">GOOGLE SHEETS</span></div>
  <form className="entry-form" onSubmit={async (event) => {
    event.preventDefault(); setQualitySaving(true); setQualityMessage(''); setQualityError('');
    const inspected = Number(qualityForm.inspectedQty), accepted = Number(qualityForm.acceptedQty), rejected = Number(qualityForm.rejectedQty), rework = Number(qualityForm.reworkQty), completed = Number(qualityForm.reworkCompletedQty);
    console.log('QUALITY DEBUG:', {
      inspected,
      accepted,
      rejected,
      rework,
      completed,
      total: accepted + rejected,
      orderId: qualityForm.orderId,
      inspectionDate: qualityForm.inspectionDate,
    });
    if (!qualityForm.orderId || !qualityForm.inspectionDate || inspected < 0 || accepted < 0 || rejected < 0 || rework < 0 || completed < 0 || accepted + rejected !== inspected || completed > rework) { setQualityError('Check required fields and quantity limits. Accepted + rejected must equal inspected; completed rework cannot exceed rework quantity.'); setQualitySaving(false); return; }
    try {
      const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'saveQuality', data: { Order_ID: qualityForm.orderId, Production_ID: qualityForm.productionId, Inspection_Date: qualityForm.inspectionDate, Inspected_Qty: inspected, Accepted_Qty: accepted, Rejected_Qty: rejected, Rework_Qty: rework, Rework_Status: qualityForm.reworkStatus, Rework_Completed_Qty: completed, Rejection_Reason: qualityForm.rejectionReason, Remarks: qualityForm.remarks } }) });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.message || result.error || 'Quality record was not saved.');
      setQualityMessage('Quality/Rework record saved.'); setQualityForm({ orderId: '', productionId: '', inspectionDate: todayDate(), inspectedQty: '', acceptedQty: '', rejectedQty: '0', reworkQty: '0', reworkStatus: 'Not Required', reworkCompletedQty: '0', rejectionReason: '', remarks: '' });
      const refreshed = await fetch(`${API_URL}?action=qualityRecords`, { method: 'GET', redirect: 'follow' }); const body = await refreshed.text(); const data = JSON.parse(body) as { success?: boolean; records?: QualityRecord[]; error?: string; message?: string }; if (!refreshed.ok || data.success !== true || !Array.isArray(data.records)) throw new Error(data.error || data.message || 'Quality record saved, but the refreshed list could not be loaded.'); setQualityRecords([...data.records].sort((a, b) => { const dateDiff = String(b.Inspection_Date || '').localeCompare(String(a.Inspection_Date || '')); return dateDiff || String(b.Quality_ID || '').localeCompare(String(a.Quality_ID || '')); }));
    } catch (error) { setQualityError(error instanceof Error ? error.message : 'Unable to save quality record.'); } finally { setQualitySaving(false); }
  }}>
    <div className="form-grid">
      <Field label="Order ID"><select value={qualityForm.orderId} onChange={e => setQualityForm({...qualityForm, orderId:e.target.value})} required><option value="">Select order</option>{orders.map(o=><option key={o.orderId} value={o.orderId}>{o.orderId} — {o.productName}</option>)}</select></Field>
      <Field label="Production ID (optional)"><input value={qualityForm.productionId} onChange={e=>setQualityForm({...qualityForm,productionId:e.target.value})} /></Field>
      <Field label="Inspection Date"><input type="date" value={qualityForm.inspectionDate} onChange={e=>setQualityForm({...qualityForm,inspectionDate:e.target.value})} required /></Field>
      <Field label="Inspected Qty"><input type="number" min="0" value={qualityForm.inspectedQty} onChange={e=>setQualityForm({...qualityForm,inspectedQty:e.target.value})} required /></Field>
      <Field label="Accepted Qty"><input type="number" min="0" value={qualityForm.acceptedQty} onChange={e=>setQualityForm({...qualityForm,acceptedQty:e.target.value})} required /></Field>
      <Field label="Rejected Qty"><input type="number" min="0" value={qualityForm.rejectedQty} onChange={e=>setQualityForm({...qualityForm,rejectedQty:e.target.value})} required /></Field>
      <Field label="Rework Qty"><input type="number" min="0" value={qualityForm.reworkQty} onChange={e=>setQualityForm({...qualityForm,reworkQty:e.target.value})} required /></Field>
      <Field label="Rework Status"><select value={qualityForm.reworkStatus} onChange={e=>setQualityForm({...qualityForm,reworkStatus:e.target.value})}><option>Not Required</option><option>Pending</option><option>In Progress</option><option>Completed</option></select></Field>
      <Field label="Rework Completed Qty"><input type="number" min="0" value={qualityForm.reworkCompletedQty} onChange={e=>setQualityForm({...qualityForm,reworkCompletedQty:e.target.value})} required /></Field>
      <Field label="Rejection Reason"><select value={qualityForm.rejectionReason} onChange={e=>setQualityForm({...qualityForm,rejectionReason:e.target.value})}><option value="">Select rejection reason</option>{QUALITY_REJECTION_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}</select></Field>
      <Field label="Remarks"><input value={qualityForm.remarks} onChange={e=>setQualityForm({...qualityForm,remarks:e.target.value})} /></Field>
    </div>
    {qualityError && <p className="form-message" role="alert">{qualityError}</p>}{qualityMessage && <p className="form-message" role="status">{qualityMessage}</p>}
    <button className="primary-button" type="submit" disabled={qualitySaving}>{qualitySaving ? 'Saving…' : 'Save Quality Record'}</button>
  </form>
  <h3>Saved Quality / Rework Records</h3>{qualityLoading ? <div className="empty-state">Loading records…</div> : <div className="table-wrap"><table><thead><tr><th>Quality ID</th><th>Order</th><th>Inspection Date</th><th>Inspected</th><th>Accepted</th><th>Rejected</th><th>Rework Qty</th><th>Status</th><th>Completed</th><th>Reason</th></tr></thead><tbody>{qualityRecords.map((r,i)=><tr key={r.Quality_ID || i}><td>{r.Quality_ID || '—'}</td><td>{r.Order_ID}</td><td>{normalizeSheetDate(r.Inspection_Date)}</td><td>{r.Inspected_Qty}</td><td>{r.Accepted_Qty}</td><td>{r.Rejected_Qty}</td><td>{r.Rework_Qty}</td><td>{r.Rework_Status}</td><td>{r.Rework_Completed_Qty}</td><td>{r.Rejection_Reason || '—'}</td></tr>)}</tbody></table>{qualityRecords.length===0 && <div className="empty-state">No quality records yet.</div>}</div>}
</section>}
{managerPage === 'dispatch-tracking' && <section className="surface records-surface">
  <div className="section-heading"><div><span className="section-index">05</span><div><h2>Dispatch Tracking</h2><p>Record finished order quantities dispatched</p></div></div><span className="draft-label">GOOGLE SHEETS</span></div>
  <form className="entry-form" onSubmit={async event => {
    event.preventDefault(); setDispatchSaving(true); setDispatchMessage(''); setDispatchError('');
    const qty=Number(dispatchForm.dispatchQty); if (!dispatchForm.orderId || !dispatchForm.dispatchDate || !Number.isFinite(qty) || qty<=0) {setDispatchError('Select an order, date, and a dispatch quantity greater than zero.');setDispatchSaving(false);return;}
    try {
      const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'saveDispatch', data: { Order_ID: dispatchForm.orderId, Dispatch_Date: dispatchForm.dispatchDate, Production_Date: dispatchForm.dispatchDate, Dispatch_Qty: qty, Remarks: dispatchForm.remarks } }) });
      const responseText = await response.text();
      let result: { success?: boolean; message?: string; error?: string };
      try { result = JSON.parse(responseText) as typeof result; }
      catch { throw new Error(`Dispatch save returned unreadable data: ${responseText.trim() || `HTTP ${response.status}`}`); }
      if (!response.ok || result.success !== true) throw new Error(result.message || result.error || `Dispatch was not saved (HTTP ${response.status}).`);
      setDispatchMessage('Dispatch record saved.');
      setDispatchForm({ orderId: '', dispatchDate: todayDate(), dispatchQty: '', remarks: '' });
      const refreshed = await fetch(`${API_URL}?action=dispatchRecords`, { method: 'GET', redirect: 'follow' });
      const refreshedText = await refreshed.text();
      let data: { success?: boolean; records?: DispatchRecord[]; message?: string; error?: string };
      try { data = JSON.parse(refreshedText) as typeof data; }
      catch { throw new Error(`Dispatch was saved, but the records list returned unreadable data: ${refreshedText.trim() || `HTTP ${refreshed.status}`}`); }
      if (!refreshed.ok || data.success !== true || !Array.isArray(data.records)) throw new Error(data.error || data.message || 'Dispatch was saved, but its records could not be refreshed.');
      setDispatchRecords(data.records);
    }
    catch(error) { setDispatchError(error instanceof Error ? error.message : 'Unable to save dispatch.'); }
    finally { setDispatchSaving(false); }
  }}>
    <div className="form-grid">
      <Field label="Order ID"><select value={dispatchForm.orderId} onChange={e=>setDispatchForm({...dispatchForm,orderId:e.target.value})} required><option value="">Select order</option>{orders.map(o=><option key={o.orderId} value={o.orderId}>{o.orderId} — {o.productName} (Qty: {o.orderQuantity})</option>)}</select></Field>
      <Field label="Dispatch Date"><input type="date" value={dispatchForm.dispatchDate} onChange={e=>setDispatchForm({...dispatchForm,dispatchDate:e.target.value})} required /></Field>
      <Field label="Dispatch Qty"><input type="number" min="1" value={dispatchForm.dispatchQty} onChange={e=>setDispatchForm({...dispatchForm,dispatchQty:e.target.value})} required /></Field>
      <Field label="Remarks"><input value={dispatchForm.remarks} onChange={e=>setDispatchForm({...dispatchForm,remarks:e.target.value})} /></Field>
    </div>
    {dispatchError && <p className="form-message" role="alert">{dispatchError}</p>}{dispatchMessage && <p className="form-message" role="status">{dispatchMessage}</p>}
    <button className="primary-button" type="submit" disabled={dispatchSaving}>{dispatchSaving ? 'Saving…' : 'Save Dispatch'}</button>
  </form>
  <h3>Saved Dispatch Records</h3>{dispatchLoading?<div className="empty-state">Loading records…</div>:<div className="table-wrap"><table><thead><tr><th>Dispatch ID</th><th>Order ID</th><th>Dispatch Date</th><th>Dispatch Qty</th><th>Remarks</th></tr></thead><tbody>{dispatchRecords.map((r,i)=><tr key={r.Dispatch_ID||i}><td>{r.Dispatch_ID||'—'}</td><td>{r.Order_ID}</td><td>{normalizeSheetDate(r.Dispatch_Date)}</td><td>{r.Dispatch_Qty}</td><td>{r.Remarks||'—'}</td></tr>)}</tbody></table>{dispatchRecords.length===0&&<div className="empty-state">No dispatch records yet.</div>}</div>}
</section>}
</>}



    <footer className="dashboard-footer">KINETIC GEARS · NAGPUR <span>PRODUCTION MONITORING SYSTEM</span><span className="local-note">{machineSyncState === 'loaded' ? 'Machine Master list loaded from Google Sheets.' : machineSyncState === 'loading' ? 'Loading Machine Master from Google Sheets.' : 'Machine Master could not be confirmed from Google Sheets; local demo data may be shown.'} Phase 2 process plans, daily tracking, quality and dispatch records use the shared Google Sheets backend.</span></footer></main></div>



}







function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={`field${wide ? ' field-wide' : ''}`}><span>{label}</span>{children}</label> }



function ManagerMachineSetup({ machines, setMachines, targets, setTargets, machineSyncState, setMachineSyncState }: { machines: Machine[]; setMachines: React.Dispatch<React.SetStateAction<Machine[]>>; targets: MachineTarget[]; setTargets: React.Dispatch<React.SetStateAction<MachineTarget[]>>; machineSyncState: 'loading' | 'loaded' | 'error'; setMachineSyncState: React.Dispatch<React.SetStateAction<'loading' | 'loaded' | 'error'>> }) {



  const [targetDate, setTargetDate] = useState(todayDate())



  const [targetMachine, setTargetMachine] = useState('')



  const [targetQuantity, setTargetQuantity] = useState('')



  const [editingTarget, setEditingTarget] = useState<string | null>(null)



  const [machineForm, setMachineForm] = useState<Machine>({ id: '', name: '', type: '', status: 'Active', remarks: '' })



  const [editingMachine, setEditingMachine] = useState<string | null>(null)



  const [machineSearch, setMachineSearch] = useState('')



  const [statusFilter, setStatusFilter] = useState('All statuses')



  const [targetSearch, setTargetSearch] = useState('')



  const [targetFilterDate, setTargetFilterDate] = useState('')



  const filteredTargets = targets.filter((target) => (!targetFilterDate || target.date === targetFilterDate) && (!targetSearch || `${target.date} ${target.machineId}`.toLowerCase().includes(targetSearch.toLowerCase())))



  const filteredMachines = machines.filter((machine) => (statusFilter === 'All statuses' || machine.status === statusFilter) && `${machine.id} ${machine.name} ${machine.type} ${machine.remarks}`.toLowerCase().includes(machineSearch.toLowerCase()))







  async function saveTarget(event: React.FormEvent<HTMLFormElement>) {



    event.preventDefault()







    const quantity = Number(targetQuantity)







    if (!targetMachine || !targetDate || !Number.isFinite(quantity) || quantity < 0) {



      window.alert('Please enter a valid date, machine and target quantity.')



      return



    }







    // Editing existing targets is not supported by the current backend route.



    if (editingTarget) {



      window.alert('Backend update support is not configured yet. Please add a new target for now.')



      return



    }







    const payload = {



      action: 'saveMachineTarget',



      Target_Date: targetDate,



      Machine_ID: targetMachine,



      Target_Qty: quantity,



      Remarks: '',



      Created_By: 'Manager'



    }







    try {



      const response = await fetch(API_URL, {



        method: 'POST',



        headers: {



          'Content-Type': 'text/plain;charset=utf-8'



        },



        body: JSON.stringify(payload)



      })







      if (!response.ok) {



        throw new Error(`Server returned HTTP ${response.status}`)



      }







      const result = await response.json()







      if (result.success !== true) {



        throw new Error(result.message || 'Backend did not confirm the target save.')



      }







      const savedTarget: MachineTarget = {



        id: String(result.targetId ?? ''),



        date: targetDate,



        machineId: targetMachine,



        quantity,



        unit: 'Nos'



      }







      setTargets(current => [savedTarget, ...current])



      setEditingTarget(null)



      setTargetQuantity('')







      window.alert('Machine target saved successfully.')







    } catch (error) {



      const message = error instanceof Error ? error.message : 'Unknown error'



      window.alert(`Unable to save machine target: ${message}`)



    }



  }















  function clearMachineForm() { setMachineForm({ id: '', name: '', type: '', status: 'Active', remarks: '' }); setEditingMachine(null) }



  async function saveMachine(event: React.FormEvent<HTMLFormElement>) {



    event.preventDefault()



    const record = { ...machineForm, id: machineForm.id.trim(), name: machineForm.name.trim(), remarks: machineForm.remarks.trim() }



    if (!record.id || !record.name) return



    if (machines.some((machine) => machine.id.toLowerCase() === record.id.toLowerCase() && machine.id !== editingMachine)) { window.alert('A machine with this ID already exists.'); return }



    try {

      const response = await fetch(`${API_URL}?action=saveMachine`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'saveMachine', Machine_ID: record.id, Machine_Name: record.name, Department: record.type, Active_Status: record.status }) })

      const responseBody = await response.text()

      let result: Record<string, unknown>

      try {

        const parsed: unknown = JSON.parse(responseBody)

        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response')

        result = parsed as Record<string, unknown>

      } catch {

        const detail = responseBody.trim() || `Server returned HTTP ${response.status} without an error message.`

        throw new Error(detail)

      }

      if (!response.ok || result.success !== true) {

        const backendError = result.error ?? result.errorMessage ?? result.message

        throw new Error(typeof backendError === 'string' && backendError.trim() ? backendError : `Server returned HTTP ${response.status} without an error message.`)

      }

      setMachines((current) => editingMachine ? current.map((machine) => machine.id === editingMachine ? record : machine) : [...current, record])

      clearMachineForm()

      try {

        const refreshedMachines = await fetchBackendMachines()

        setMachines(refreshedMachines)

        setMachineSyncState('loaded')

        window.alert('Machine saved successfully to Google Sheets.')

      } catch (refreshError) {

        setMachineSyncState('error')

        const detail = refreshError instanceof Error ? refreshError.message : 'Unknown error'

        window.alert(`Machine was saved to Google Sheets, but the list could not be refreshed: ${detail}`)

      }

    } catch (error) {

      const message = error instanceof Error ? error.message : 'Unknown error'

      window.alert(`Unable to save machine to Google Sheets: ${message}`)

    }



  }



  return <div className="manager-machine-setup">



    <section className="surface manager-config-card"><div className="section-heading"><div><span className="section-index">02</span><div><h2>Machine Targets</h2><p>Set production targets by machine and date</p></div></div><span className="draft-label">GOOGLE SHEETS</span></div>



      <form className="entry-form" onSubmit={saveTarget}><div className="form-grid target-form-grid"><Field label="Target Date"><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} required /></Field><Field label="Machine"><select value={targetMachine} onChange={(event) => setTargetMachine(event.target.value)} required><option value="">Select machine</option>{machines.filter((machine) => machine.status === 'Active').map((machine) => <option key={machine.id} value={machine.id}>{machine.id} — {machine.name}</option>)}</select></Field><Field label="Target Quantity"><input type="number" min="0" value={targetQuantity} onChange={(event) => setTargetQuantity(event.target.value)} placeholder="0" required /></Field><div className="target-submit"><button className="primary-button save-button" type="submit">{editingTarget ? 'Update Target' : 'Save Target'}</button></div></div></form>



      <div className="manager-table-tools"><input aria-label="Search targets" placeholder="Search targets" value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} /><label>Date filter<input type="date" value={targetFilterDate} onChange={(event) => setTargetFilterDate(event.target.value)} /></label></div>



      <div className="table-wrap"><table><thead><tr><th>Target Date</th><th>Machine ID</th><th>Machine Name</th><th>Target Quantity</th><th>Actions</th></tr></thead><tbody>{filteredTargets.map((target) => <tr key={target.id}><td>{target.date}</td><td><b>{target.machineId}</b></td><td>{machines.find((machine) => machine.id === target.machineId)?.name ?? 'Machine unavailable'}</td><td>{target.quantity} {target.unit ?? 'Nos'}</td><td className="table-actions"><button type="button" onClick={() => { setEditingTarget(target.id); setTargetDate(target.date); setTargetMachine(target.machineId); setTargetQuantity(String(target.quantity)) }}>Edit</button><button type="button" className="danger-action" onClick={() => setTargets((current) => current.filter((item) => item.id !== target.id))}>Delete</button></td></tr>)}</tbody></table>{filteredTargets.length === 0 && <div className="empty-state">No saved targets match the selected filters.</div>}</div>



    </section>



    <section className="manager-master-title"><div><span className="section-index">03</span><div><h2>Machine Master</h2><p>Manage the machines available for production planning</p></div></div><span className="draft-label">{machineSyncState === 'loaded' ? 'GOOGLE SHEETS' : machineSyncState === 'loading' ? 'LOADING SHEETS' : 'SHEETS UNAVAILABLE · LOCAL DATA'}</span></section>



    <section className="surface manager-config-card"><div className="section-heading"><div><span className="section-index">A</span><div><h2>{editingMachine ? 'Edit Machine' : 'Add New Machine'}</h2><p>Enter machine details</p></div></div></div>



      <form className="entry-form" onSubmit={saveMachine}><div className="form-grid"><Field label="Machine ID"><input value={machineForm.id} onChange={(event) => setMachineForm({ ...machineForm, id: event.target.value })} placeholder="Machine ID" required disabled={!!editingMachine} /></Field><Field label="Machine Name"><input value={machineForm.name} onChange={(event) => setMachineForm({ ...machineForm, name: event.target.value })} placeholder="Machine name" required /></Field><Field label="Machine Type"><select value={machineForm.type} onChange={(event) => setMachineForm({ ...machineForm, type: event.target.value })} required><option value="">Select type</option>{['CNC Turning', 'Gear Hobbing', 'Gear Shaping', 'Gear Grinding', 'Machining', 'Drilling', 'Heat Treatment', 'Quality Inspection', 'CNC', 'Lathe', 'Milling', 'Grinding', 'Other'].map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Status"><select value={machineForm.status} onChange={(event) => setMachineForm({ ...machineForm, status: event.target.value as Machine['status'] })}><option>Active</option><option>Maintenance</option><option>Inactive</option></select></Field><Field label="Remarks" wide><input value={machineForm.remarks} onChange={(event) => setMachineForm({ ...machineForm, remarks: event.target.value })} placeholder="Optional remarks" /></Field></div><div className="form-actions machine-form-actions"><span>{machineSyncState === 'loaded' ? 'Machine Master list is loaded from Google Sheets.' : machineSyncState === 'loading' ? 'Loading Machine Master from Google Sheets...' : 'Google Sheets unavailable; displayed machines may be browser demo data.'}</span><div><button className="secondary-button" type="button" onClick={clearMachineForm}>Clear</button><button className="primary-button save-button" type="submit">{editingMachine ? 'Update Machine' : 'Add Machine'}</button></div></div></form>



    </section>



    <section className="surface manager-config-card"><div className="section-heading"><div><span className="section-index">B</span><div><h2>Machine List</h2><p>{filteredMachines.length} machines</p></div></div></div><div className="manager-table-tools"><input aria-label="Search machines" placeholder="Search machine ID, name, type, remarks" value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} /><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>Active</option><option>Maintenance</option><option>Inactive</option></select></label></div><div className="table-wrap"><table><thead><tr><th>Machine ID</th><th>Machine Name</th><th>Machine Type</th><th>Status</th><th>Remarks</th><th>Actions</th></tr></thead><tbody>{filteredMachines.map((machine) => <tr key={machine.id}><td><b>{machine.id}</b></td><td>{machine.name}</td><td>{machine.type}</td><td><span className={`machine-status ${machine.status.toLowerCase()}`}>{machine.status}</span></td><td>{machine.remarks || '—'}</td><td className="table-actions"><button type="button" onClick={() => { setEditingMachine(machine.id); setMachineForm(machine) }}>Edit</button><button type="button" className="danger-action" onClick={() => { setMachines((current) => current.filter((item) => item.id !== machine.id)); setTargets((current) => current.filter((target) => target.machineId !== machine.id)); if (editingMachine === machine.id) clearMachineForm() }}>Delete</button></td></tr>)}</tbody></table>{filteredMachines.length === 0 && <div className="empty-state">No saved machines match the selected filters.</div>}</div></section>



  </div>



}



function EntryTable({ entries }: { entries: Entry[] }) {



  return <div className="table-wrap"><table><thead><tr><th>Date</th><th>Shift</th><th>Machine</th><th>Product</th><th>Target</th><th>Actual</th><th>Good</th><th>Rejected</th><th>Shortfall Qty.</th><th>Shortfall Reason</th><th>Rejection Reason</th></tr></thead><tbody>{entries.map((e, i) => { const shortfall = Math.max(0, e.target - e.actual); const rejectionReason = e.rejectionReason || ''; return <tr key={e.machine + '-' + i}><td>{new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td><td><span className="shift-pill">{e.shift}</span></td><td><b>{e.machine}</b></td><td>{e.product}</td><td>{e.target}</td><td>{e.actual}</td><td className="good-cell">{e.good}</td><td className={e.rejected ? 'reject-cell' : ''}>{e.rejected}</td><td>{shortfall > 0 ? shortfall : '—'}</td><td>{shortfall > 0 ? (e.shortfallReason || '—') : '—'}</td><td>{e.rejected > 0 ? (rejectionReason || '—') : '—'}</td></tr>})}</tbody></table>{entries.length === 0 && <div className="empty-state">No entries yet. Add your first production entry above.</div>}</div>



}








type MachineProcessJourney = {
  journeyId: string;
  orderId: string;
  partNumber: string;
  machineId: string;
  processName: string;
  sequence: number;
  plannedQty: number;
  completedQty: number;
  pendingQty: number;
  status: string;
  assignedSupervisorEmail: string;
};

function MachineProcessPlanning() {
  const [journeys, setJourneys] = useState<MachineProcessJourney[]>([]);
  const [trackingRecords, setTrackingRecords] = useState<Record<string, string>[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [trackingLoading, setTrackingLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    orderId: '', partNumber: '', machineId: '', processName: '',
    plannedQty: '', plannedDate: todayDate(), remarks: '',
    assignedSupervisorEmail: '',
  });

  const nextSequence = journeys
    .filter(journey => journey.orderId.trim().toLowerCase() === form.orderId.trim().toLowerCase()
      && journey.partNumber.trim().toLowerCase() === form.partNumber.trim().toLowerCase())
    .reduce((max, journey) => Math.max(max, Number(journey.sequence) || 0), 0) + 1;

  const loadJourneys = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}?action=machineProcessJourney`, { method: 'GET', redirect: 'follow' });
      const result = await response.json();
      if (!response.ok || result.success !== true || !Array.isArray(result.journeys)) {
        throw new Error(String(result.message || result.error || 'Unable to load process plans'));
      }
      setJourneys(result.journeys.map((row: Record<string, unknown>) => ({
        journeyId: String(row.Machine_Process_Journey_ID ?? ''),
        orderId: String(row.Order_ID ?? ''),
        partNumber: String(row.Part_Number ?? ''),
        machineId: String(row.Machine_ID ?? ''),
        processName: String(row.Process_Name ?? ''),
        sequence: Number(row.Process_Sequence ?? 1),
        plannedQty: Number(row.Planned_Qty ?? 0),
        completedQty: Number(row.Completed_Qty ?? 0),
        pendingQty: Number(row.Pending_Qty ?? 0),
        status: String(row.Process_Status ?? 'Planned'),
        assignedSupervisorEmail: String(row.Assigned_Supervisor_Email ?? '').trim().toLowerCase(),
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load process plans');
    } finally { setLoading(false); }
  };

  const loadTracking = async () => {
    setTrackingLoading(true);
    try {
      const response = await fetch(`${API_URL}?action=machineProcessTracking`, { method: 'GET', redirect: 'follow' });
      const result = await response.json();
      if (!response.ok || result.success !== true || !Array.isArray(result.records)) {
        throw new Error(String(result.message || result.error || 'Unable to load daily tracking records'));
      }
      setTrackingRecords(result.records as Record<string, string>[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load daily tracking records');
    } finally { setTrackingLoading(false); }
  };

  const refreshAll = async () => { await Promise.all([loadJourneys(), loadTracking()]); };
  useEffect(() => { void refreshAll(); }, []);

  // Use Phase 1's registered orders and machine master from the same Apps Script backend.
  useEffect(() => {
    let cancelled = false;
    async function loadReferenceData() {
      setReferenceLoading(true);
      try {
        const [orderRows, machineRows] = await Promise.all([fetchBackendOrders(), fetchBackendMachines()]);
        if (!cancelled) {
          setOrders(orderRows);
          setMachines(machineRows.filter(machine => machine.status === 'Active'));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load Phase 1 orders and machines.');
      } finally {
        if (!cancelled) setReferenceLoading(false);
      }
    }
    void loadReferenceData();
    return () => { cancelled = true; };
  }, []);

  const savePlan = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setMessage(''); setError('');
    try {
      if (!form.orderId.trim()) throw new Error('Enter an Order ID.');
      if (!form.partNumber.trim()) throw new Error('Enter a Part Number.');
      if (!form.processName.trim()) throw new Error('Select a Process Name.');
      if (!form.machineId.trim()) throw new Error('Enter a Machine ID.');
      if (!Number.isInteger(Number(form.plannedQty)) || Number(form.plannedQty) <= 0) throw new Error('Planned Quantity must be a positive whole number.');
      if (!form.assignedSupervisorEmail.trim()) throw new Error('Please select a Supervisor for this process.');
      const payload = {
        action: 'saveMachineProcessPlan',
        Order_ID: form.orderId.trim(),
        Part_Number: form.partNumber.trim(),
        Process_Sequence: nextSequence,
        Process_Name: form.processName.trim(),
        Machine_ID: form.machineId.trim(),
        Planned_Qty: Number(form.plannedQty),
        Assigned_Supervisor_Email: form.assignedSupervisorEmail.trim().toLowerCase(),
      };
      const response = await fetch(API_URL, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        throw new Error(String(result.message || result.error || 'Could not save process plan'));
      }
      setMessage(`Process plan saved${result.machineProcessJourneyId ? ` (${result.machineProcessJourneyId})` : ''}.`);
      setForm({ orderId: '', partNumber: '', machineId: '', processName: '', plannedQty: '', plannedDate: todayDate(), remarks: '', assignedSupervisorEmail: '' });
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save process plan');
    } finally { setSaving(false); }
  };

  const updateProgress = async (journey: MachineProcessJourney, completedQty: number) => {
    const safeQty = Number(completedQty);
    if (!Number.isFinite(safeQty) || safeQty < 0 || safeQty > journey.plannedQty) {
      setError(`Completed quantity must be between 0 and ${journey.plannedQty}.`); return;
    }
    setError(''); setMessage('');
    try {
      const response = await fetch(API_URL, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'updateMachineProcessProgress', Machine_Process_Journey_ID: journey.journeyId, Completed_Qty: safeQty }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(String(result.message || result.error || 'Progress update failed'));
      setMessage(`Progress updated for ${journey.journeyId}.`);
      await loadJourneys();
    } catch (e) { setError(e instanceof Error ? e.message : 'Progress update failed'); }
  };

  return <div className="manager-machine-setup">
    <section className="surface manager-config-card">
      <div className="section-heading">
        <div><span className="section-index">06</span><div><h2>Machine Process Planning</h2><p>Plan order-wise process stages and assign each process to a Supervisor</p></div></div>
        <span className="draft-label">GOOGLE SHEETS</span>
      </div>
      <form className="entry-form" onSubmit={savePlan}>
        <div className="form-grid">
          <Field label="Phase 1 Registered Order"><select value={form.orderId} onChange={e => {
            const selected = orders.find(order => order.orderId === e.target.value);
            setForm({ ...form, orderId: e.target.value, partNumber: selected?.partNumber || selected?.productName || '' });
          }} required disabled={referenceLoading}>
            <option value="">{referenceLoading ? 'Loading orders…' : 'Select registered order'}</option>
            {orders.map(order => <option key={order.orderId} value={order.orderId}>{order.orderId} — {order.partNumber || order.productName} (Qty: {order.orderQuantity})</option>)}
          </select></Field>
          <Field label="Part Number"><input value={form.partNumber} onChange={e => setForm({ ...form, partNumber: e.target.value })} placeholder="Auto-filled from selected order" required /></Field>
          <Field label="Phase 1 Machine Master"><select value={form.machineId} onChange={e => setForm({ ...form, machineId: e.target.value })} required disabled={referenceLoading}>
            <option value="">{referenceLoading ? 'Loading machines…' : 'Select active machine'}</option>
            {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.id} — {machine.name}</option>)}
          </select></Field>
          <Field label="Process Name"><select value={form.processName} onChange={e => setForm({ ...form, processName: e.target.value })} required><option value="">Select process</option>{MANUFACTURING_PROCESS_OPTIONS.map(process => <option key={process} value={process}>{process}</option>)}</select></Field>
          <Field label="Process Sequence (Automatic)"><input type="number" value={form.orderId.trim() ? nextSequence : ''} readOnly aria-readonly="true" /></Field>
          <Field label="Planned Quantity"><input type="number" min="1" step="1" value={form.plannedQty} onChange={e => setForm({ ...form, plannedQty: e.target.value })} required /></Field>
          <Field label="Assigned Supervisor"><select value={form.assignedSupervisorEmail} onChange={e => setForm({ ...form, assignedSupervisorEmail: e.target.value })} required>
            <option value="">Select Supervisor</option>
            {demoAccounts.filter(account => account.role === 'Supervisor').map(account => <option key={account.email} value={account.email}>{account.email}</option>)}
          </select></Field>
          <Field label="Planned Date"><input type="date" value={form.plannedDate} onChange={e => setForm({ ...form, plannedDate: e.target.value })} required /></Field>
          <Field label="Remarks" wide><input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} placeholder="Optional" /></Field>
        </div>
        <div className="form-actions"><span>{message || error}</span><button className="primary-button save-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Process Plan'}</button></div>
      </form>
    </section>

    <section className="surface records-surface">
      <div className="section-heading"><div><span className="section-index">07</span><div><h2>Process Journey & Progress</h2><p>Review planned, completed and pending quantities by process</p></div></div><button className="secondary-button" type="button" onClick={() => void refreshAll()}>Refresh</button></div>
      {loading ? <div className="empty-state">Loading process journey…</div> : <div className="table-wrap">
        <table><thead><tr><th>Journey ID</th><th>Order</th><th>Part</th><th>Machine</th><th>Process</th><th>Sequence</th><th>Planned</th><th>Completed</th><th>Pending</th><th>Status</th><th>Assigned Supervisor</th><th>Manager Override</th></tr></thead>
          <tbody>{journeys.map(j => <tr key={j.journeyId}>
            <td>{j.journeyId}</td><td>{j.orderId}</td><td>{j.partNumber}</td><td>{j.machineId}</td><td>{j.processName}</td><td>{j.sequence}</td><td>{j.plannedQty}</td><td>{j.completedQty}</td><td>{j.pendingQty}</td><td>{j.status}</td><td>{j.assignedSupervisorEmail || '—'}</td>
            <td><button type="button" className="secondary-button" onClick={() => {
              const raw = window.prompt(`Set cumulative completed quantity for ${j.journeyId}`, String(j.completedQty));
              if (raw !== null && raw.trim() !== '') void updateProgress(j, Number(raw));
            }}>Edit</button></td>
          </tr>)}</tbody>
        </table>
        {journeys.length === 0 && <div className="empty-state">No process journeys yet. Add a process plan above.</div>}
      </div>}
      {referenceLoading && <p className="form-message" role="status">Loading registered Phase 1 orders and active machines…</p>}
      {!referenceLoading && orders.length === 0 && <p className="form-message" role="alert">No Phase 1 orders found. Register an order in Phase 1 before creating a machine process plan.</p>}
      {!referenceLoading && machines.length === 0 && <p className="form-message" role="alert">No active machines found in Phase 1 Machine Master. Add or activate a machine in Phase 1 first.</p>}
      {error && <p className="form-message" role="alert">{error}</p>}
    </section>

    <section className="surface records-surface">
      <div className="section-heading"><div><span className="section-index">08</span><div><h2>Daily Machine Process Tracking</h2><p>Supervisor-submitted daily production records</p></div></div><button className="secondary-button" type="button" onClick={() => void loadTracking()}>Refresh</button></div>
      {trackingLoading ? <div className="empty-state">Loading daily records…</div> : <div className="table-wrap">
        <table><thead><tr><th>Tracking ID</th><th>Production Date</th><th>Production ID</th><th>Order</th><th>Part</th><th>Process</th><th>Machine</th><th>Shift</th><th>Actual</th><th>Good</th><th>Rejected</th><th>Rework</th><th>Pending</th><th>Supervisor</th><th>Updated At</th></tr></thead>
          <tbody>{trackingRecords.map((r, i) => <tr key={String(r.Tracking_ID || i)}>
            <td>{r.Tracking_ID}</td><td>{r.Production_Date || '—'}</td><td>{r.Production_Record_ID}</td><td>{r.Order_ID}</td><td>{r.Part_Number}</td><td>{r.Process_Name}</td><td>{r.Machine_ID}</td><td>{r.Shift}</td><td>{r.Actual_Qty}</td><td>{r.Good_Qty}</td><td>{r.Rejected_Qty}</td><td>{r.Rework_Qty}</td><td>{r.Pending_Qty}</td><td>{r.Supervisor_Email}</td><td>{r.Updated_At}</td>
          </tr>)}</tbody></table>
        {trackingRecords.length === 0 && <div className="empty-state">No daily tracking records have been submitted yet.</div>}
      </div>}
    </section>
  </div>;
}


// Supervisor workspace: assigned process plans and daily production submission.

  // Retain this existing component without exporting it from inside the workspace factory.
  void MachineProcessPlanning;

  return Phase2Workspace;
}

const Phase2Workspace = createPhase2Workspace();
