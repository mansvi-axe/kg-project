import { useEffect, useMemo, useRef, useState } from 'react'



import './App.css'







const API_URL = 'https://script.google.com/macros/s/AKfycbx2l-R4qea9DvppWGhbCSC15zjtpJM7FBHWiC3eYUkN34tuwo4nIS059VcdWwm_Mivlag/exec'



type Role = 'Supervisor' | 'Manager'

type ProblemStatus = 'Pending' | 'In Progress' | 'Resolved'



type Entry = { recordId?: string; date: string; shift: string; machine: string; product: string; target: number; actual: number; good: number; rejected: number; reason: string; remarks: string; shortfallReason?: string; rejectionReason?: string }



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







function App() {



  const [role, setRole] = useState<Role | null>(null)



const [managerPage, setManagerPage] = useState<
  'dashboard' | 'machine-management' | 'order-management' | 'order-tracking' | 'production-planning'
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
          : role === 'Supervisor'
            ? 'Supervisor Home'
            : 'Manager Production Dashboard'


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
)} {role === 'Supervisor' && (
  <button className={`nav-item${managerPage === 'production-planning' ? ' active' : ''}`} onClick={() => setManagerPage('production-planning')}>
    {icon('production')}<span>Production Planning</span>
  </button>
)}{role === 'Supervisor' && <><a className="nav-item" href="#entry">{icon('factory')}<span>My Production</span></a><a className="nav-item" href="#records">{icon('chart')}<span>My Records</span></a></>}<div className="sidebar-bottom"><div className="user-chip"><span className="user-avatar">{role[0]}</span><span><b>{role}</b><small>{email}</small></span></div><button className="logout-button" onClick={logout}>{icon('logout')}<span>Logout</span></button></div></aside>



    <main className="dashboard"><header className="dash-header"><div><div className="breadcrumb">WORKSPACE <span>/</span> {role === 'Supervisor' ? 'SUPERVISOR' : 'MANAGER'}</div><h1>{pageTitle}</h1><p>{role === 'Manager' && managerPage === 'machine-management' ? 'Manage machine targets and master records' : 'Production overview and operational performance'}</p></div><div className="header-date">{icon('calendar')}<span>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></div></header>



    {role === 'Supervisor' && managerPage === 'dashboard' ? <><section className="summary-grid"><article className="summary-card"><span className="summary-icon blue">{icon('factory')}</span><div><small>Production Entries</small><strong>{entries.length}</strong><span className="summary-note">Recorded in this demo</span></div></article><article className="summary-card"><span className="summary-icon amber">{icon('quality')}</span><div><small>Open Problems</small><strong>{openProblems}</strong><span className="summary-note">Needs review</span></div></article></section>



      <section className="surface" id="entry"><div className="section-heading"><div><span className="section-index">01</span><div><h2>Production Entry</h2><p>Log output for your shift</p></div></div><span className="draft-label">PRODUCTION ENTRY</span></div><form className="entry-form" onSubmit={saveEntry}><div className="form-grid"><Field label="Production Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value, shortfallReason: '', shortfallOtherReason: '', reason: '', otherReason: '' })} required /></Field><Field label="Shift"><select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}><option>Morning</option><option>Evening</option><option>Night</option></select></Field><Field label="Machine"><select value={form.machine} onChange={(e) => setForm({ ...form, machine: e.target.value, shortfallReason: '', shortfallOtherReason: '', reason: '', otherReason: '' })} required><option value="">Select active machine</option>{activeMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.id} — {machine.name}</option>)}</select></Field><Field label="Product / Part Number"><input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="e.g. KG-2048" required /></Field><Field label="Target Quantity"><input type="number" min="0" value={applicableTarget?.quantity ?? ''} readOnly placeholder="Select machine and date" required={!!form.machine} />{form.machine && !applicableTarget && <small className="form-message">No target is saved for this machine and date.</small>}</Field><Field label="Actual Quantity"><input type="number" min="0" value={form.actual} onChange={(e) => setForm({ ...form, actual: e.target.value, ...(e.target.value !== '' && Number(e.target.value) < targetQuantity ? {} : { shortfallReason: '', shortfallOtherReason: '' }) })} placeholder="0" required /></Field><Field label="Rejected Quantity"><input type="number" min="0" max={form.actual || undefined} value={form.rejected} onChange={(e) => setForm({ ...form, rejected: e.target.value, ...(Number(e.target.value || 0) > 0 ? {} : { reason: '', otherReason: '' }) })} placeholder="0" required /></Field><Field label="Good Quantity"><div className="calculated">{good}<span>AUTO CALCULATED</span></div></Field>{showShortfallDetails && <fieldset className="conditional-details field-wide"><legend>Shortfall Details</legend><div className="detail-summary"><span>Shortfall Quantity</span><strong>{shortfallQuantity}</strong></div><Field label="Shortfall Reason"><select value={form.shortfallReason} onChange={(e) => setForm({ ...form, shortfallReason: e.target.value, shortfallOtherReason: '' })} required={showShortfallDetails}><option value="">Select a reason (required)</option>{['Machine Breakdown', 'Production Delay', 'Raw Material Shortage', 'Manpower Shortage', 'Tool / Machine Setting Issue', 'Power Failure', 'Other'].map((item) => <option key={item}>{item}</option>)}</select></Field>{form.shortfallReason === 'Other' && <Field label="Other Reason"><input value={form.shortfallOtherReason} onChange={(e) => setForm({ ...form, shortfallOtherReason: e.target.value })} required={showShortfallDetails} placeholder="Describe the shortfall reason" /></Field>}</fieldset>}{showRejectionDetails && <fieldset className="conditional-details field-wide"><legend>Rejection Details</legend><div className="detail-summary"><span>Rejected Quantity</span><strong>{rejectedQuantity}</strong></div><Field label="Rejection Reason"><select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value, otherReason: '' })} required={showRejectionDetails}><option value="">Select a reason (required)</option>{['Dimensional Issue', 'Surface Defect', 'Wrong Size', 'Material Defect', 'Machine Setting Issue', 'Other'].map((item) => <option key={item}>{item}</option>)}</select></Field>{form.reason === 'Other' && <Field label="Other Reason"><input value={form.otherReason} onChange={(e) => setForm({ ...form, otherReason: e.target.value })} required={showRejectionDetails} placeholder="Describe the rejection reason" /></Field>}</fieldset>}</div><div className="form-actions"><span>Entry is saved to the configured production endpoint and this browser.</span><button className="primary-button save-button" type="submit">Save Production Entry <span>{icon('arrow')}</span></button></div></form></section>



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
<div className={`manager-machine-page${managerPage === 'machine-management' ? '' : ' is-hidden'}`}><ManagerMachineSetup machines={machines} setMachines={setMachines} targets={targets} setTargets={setTargets} machineSyncState={machineSyncState} setMachineSyncState={setMachineSyncState} /></div></>}



    <footer className="dashboard-footer">KINETIC GEARS · NAGPUR <span>PRODUCTION MONITORING SYSTEM</span><span className="local-note">{machineSyncState === 'loaded' ? 'Machine Master list loaded from Google Sheets.' : machineSyncState === 'loading' ? 'Loading Machine Master from Google Sheets.' : 'Machine Master could not be confirmed from Google Sheets; local demo data may be shown.'} Machine targets persist in this browser; production entries are also sent to the configured endpoint.</span></footer></main></div>



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



        id: result.targetId,



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



    <section className="surface manager-config-card"><div className="section-heading"><div><span className="section-index">02</span><div><h2>Machine Targets</h2><p>Set production targets by machine and date</p></div></div><span className="draft-label">SAVED IN THIS BROWSER</span></div>



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







export default App
