import type {
  Department,
  ReportTemplateConfig,
  ReportTemplateField,
  TemplateSection,
  Weekday,
} from '@/types/domain'

const weekdaysAll: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

const weekdaysClinic: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
]

const inpatientSections: TemplateSection[] = [
  {
    id: 'patient_flow',
    title: 'Patient Flow',
    description: 'Admissions, transfers, discharges, and capacity movement.',
  },
  {
    id: 'quality_safety',
    title: 'Quality & Safety',
    description: 'Events, infections, and quality indicators that need oversight.',
  },
  {
    id: 'capacity',
    title: 'Capacity & Stay',
    description: 'Bed usage, length of stay, and occupancy-related indicators.',
  },
  {
    id: 'staffing',
    title: 'Rounds & Staffing',
    description: 'Operational coverage fields that are best reviewed alongside clinical flow.',
  },
]

const outpatientSections: TemplateSection[] = [
  {
    id: 'activity',
    title: 'Clinic Activity',
    description: 'Volume, mix, and same-day service delivery.',
  },
  {
    id: 'access',
    title: 'Access & Delay',
    description: 'Wait time and appointment performance signals.',
  },
  {
    id: 'staffing',
    title: 'Staffing & Coverage',
    description: 'Clinic start and leadership presence.',
  },
]

const procedureSections: TemplateSection[] = [
  {
    id: 'throughput',
    title: 'Service Throughput',
    description: 'Core service delivery volume by day.',
  },
  {
    id: 'turnaround',
    title: 'Turnaround & Waiting',
    description: 'Waiting time and reporting turnaround indicators.',
  },
  {
    id: 'staffing',
    title: 'Reporting Staff',
    description: 'Named operational accountability for the reporting week.',
  },
]

function numericField(
  id: string,
  label: string,
  sectionId: string,
  options?: Partial<ReportTemplateField>,
): ReportTemplateField {
  return {
    id,
    label,
    sectionId,
    kind: 'integer',
    aggregate: 'sum',
    readOnlyWeeklyTotal: true,
    ...options,
  }
}

function decimalAverageField(
  id: string,
  label: string,
  sectionId: string,
  unit: string,
): ReportTemplateField {
  return {
    id,
    label,
    sectionId,
    kind: 'decimal',
    aggregate: 'average',
    unit,
    readOnlyWeeklyTotal: true,
  }
}

function timeField(id: string, label: string, sectionId: string): ReportTemplateField {
  return {
    id,
    label,
    sectionId,
    kind: 'time',
    aggregate: 'latest',
  }
}

function textField(id: string, label: string, sectionId: string): ReportTemplateField {
  return {
    id,
    label,
    sectionId,
    kind: 'text',
    aggregate: 'latest',
  }
}

function choiceField(
  id: string,
  label: string,
  sectionId: string,
  options: string[],
): ReportTemplateField {
  return {
    id,
    label,
    sectionId,
    kind: 'choice',
    aggregate: 'latest',
    options,
  }
}

export const reportTemplates: ReportTemplateConfig[] = [
  {
    id: 'inpatient_weekly',
    family: 'inpatient',
    name: 'Inpatient Weekly Report',
    description: 'Shared weekly operational template for inpatient wards.',
    activeDays: weekdaysAll,
    sections: inpatientSections,
    fields: [
      numericField('total_admitted_patients', 'Total Number of Admitted Patients', 'patient_flow'),
      numericField('new_admitted_patients', 'Number of Newly Admitted Patients', 'patient_flow'),
      numericField(
        'readmitted_30d',
        'Number of Newly Readmitted Patients within 30 days of discharge',
        'patient_flow',
      ),
      numericField('new_deaths', 'Number of New Deaths', 'quality_safety', {
        highlightWhenNonZero: true,
      }),
      numericField(
        'new_pressure_ulcer',
        'Number of Patients Who Developed New Pressure Ulcer',
        'quality_safety',
        { highlightWhenNonZero: true },
      ),
      numericField(
        'total_pressure_ulcer',
        'Total Number of Patients With Pressure Ulcer',
        'quality_safety',
      ),
      numericField(
        'total_hai',
        'Total Number of Patients With Hospital-acquired infections (AIs)',
        'quality_safety',
        { highlightWhenNonZero: true },
      ),
      numericField('hai_clabsi', 'Central line-associated bloodstream Infection', 'quality_safety', {
        highlightWhenNonZero: true,
      }),
      numericField('hai_cauti', 'Catheter-Associated Urinary tract infection', 'quality_safety', {
        highlightWhenNonZero: true,
      }),
      numericField('hai_pneumonia', 'Pneumonia', 'quality_safety', {
        highlightWhenNonZero: true,
      }),
      numericField('hai_vap', 'Ventilator-associated pneumonia (VAP)', 'quality_safety', {
        highlightWhenNonZero: true,
      }),
      numericField('hai_cdi', 'Clostridium difficile infections (CDI)', 'quality_safety', {
        highlightWhenNonZero: true,
      }),
      numericField(
        'urinary_catheter',
        'Number of patients that are on urinary catheter',
        'quality_safety',
      ),
      numericField('transferred_icu', 'Number of Patients Transferred to ICU', 'patient_flow'),
      numericField('transferred_hdu', 'Number of Patients Transferred to HDU', 'patient_flow'),
      numericField('transferred_ward', 'Number of Patients Transferred to Ward', 'patient_flow'),
      numericField(
        'discharged_home',
        'Number of Patients Discharged Home (Rx Completed)',
        'patient_flow',
      ),
      numericField(
        'discharged_ama',
        'Number of Patients Discharged Against Medical Advice',
        'patient_flow',
      ),
      numericField('free_beds', 'Number of Free Beds', 'capacity'),
      decimalAverageField('median_los_days', 'Median Length of Stay (LOS) in Days', 'capacity', 'days'),
      numericField('total_patient_days', 'Total Patient Days', 'capacity'),
      timeField('mdt_round_start_day', 'MDT Round Start Time (Day-working hours)', 'staffing'),
      timeField('mdt_round_start_duty', 'MDT Round Start Time (Duty hours)', 'staffing'),
      textField('duty_resident', 'Duty resident', 'staffing'),
      textField('duty_senior_physician', 'Duty senior physician', 'staffing'),
      textField('nurse_in_charge', 'Nurse In Charge (NI) Name', 'staffing'),
    ],
    summaryCards: [
      { id: 'admissions', label: 'Admissions', sourceType: 'field', sourceId: 'total_admitted_patients', format: 'integer' },
      { id: 'discharges', label: 'Discharges', sourceType: 'field', sourceId: 'discharged_home', format: 'integer' },
      { id: 'hai', label: 'HAI Count', sourceType: 'field', sourceId: 'total_hai', format: 'integer' },
      { id: 'bor', label: 'BOR %', sourceType: 'metric', sourceId: 'borPercent', format: 'percent' },
      { id: 'btr', label: 'BTR', sourceType: 'metric', sourceId: 'btr', format: 'decimal' },
      { id: 'alos', label: 'ALOS', sourceType: 'metric', sourceId: 'alos', format: 'days' },
    ],
    chartMappings: [
      {
        id: 'admission_trend',
        title: 'Admissions & Discharges',
        chartType: 'line',
        series: [
          { sourceType: 'field', sourceId: 'total_admitted_patients', label: 'Admissions', color: '#0f8ea8' },
          { sourceType: 'field', sourceId: 'discharged_home', label: 'Discharged Home', color: '#1a5f7a' },
        ],
      },
      {
        id: 'quality_events',
        title: 'Safety Events',
        chartType: 'stacked-bar',
        series: [
          { sourceType: 'field', sourceId: 'new_deaths', label: 'Deaths', color: '#d97706' },
          { sourceType: 'field', sourceId: 'new_pressure_ulcer', label: 'New Pressure Ulcers', color: '#b45309' },
          { sourceType: 'field', sourceId: 'total_hai', label: 'HAI', color: '#dc2626' },
        ],
      },
      {
        id: 'occupancy_metrics',
        title: 'Occupancy & Stay',
        chartType: 'bar',
        series: [
          { sourceType: 'metric', sourceId: 'borPercent', label: 'BOR %', color: '#0f8ea8' },
          { sourceType: 'metric', sourceId: 'btr', label: 'BTR', color: '#2563eb' },
          { sourceType: 'metric', sourceId: 'alos', label: 'ALOS', color: '#0f766e' },
        ],
      },
    ],
    changeRules: [
      {
        fieldId: 'total_admitted_patients',
        percentThreshold: 10,
        messageTemplate: '{department} inpatient admissions changed by {deltaPercent}% compared with last week.',
      },
      {
        fieldId: 'total_hai',
        percentThreshold: 1,
        messageTemplate: '{department} reported {currentValue} HAIs this week.',
      },
    ],
  },
  {
    id: 'outpatient_weekly',
    family: 'outpatient',
    name: 'ART',
    description: 'Weekly outpatient ART clinic activity and access reporting.',
    activeDays: weekdaysClinic,
    sections: outpatientSections,
    fields: [
      numericField('total_patients_seen', 'Total Number of Patients Seen', 'activity'),
      numericField('follow_up_patients', 'Number of Follow-up Patients', 'activity'),
      numericField('new_patients_seen', 'Number of New Patients Seen', 'activity'),
      numericField('not_seen_same_day', 'Number of Patients Not Seen on Same Day', 'activity'),
      decimalAverageField(
        'wait_time_new_days',
        'Average Appointment Wait Time For New Patients',
        'access',
        'days',
      ),
      decimalAverageField(
        'wait_time_followup_months',
        'Average Appointment Wait Time For Follow-up Patients',
        'access',
        'months',
      ),
      numericField(
        'failed_to_come',
        'Number of Patients Who Failed to Come For Their Appointment',
        'access',
      ),
      numericField(
        'not_seen_appointment',
        'Number of Patients Who Are Not Seen During Their Appointment',
        'access',
      ),
      timeField('clinic_start_time', 'Clinic Start Time', 'staffing'),
      choiceField(
        'senior_physician_availability',
        'Senior physician availability',
        'staffing',
        ['Full day', 'Partial day', 'Unavailable'],
      ),
      textField('nurse_in_charge', 'Nurse In Charge (NI) Name', 'staffing'),
    ],
    summaryCards: [
      { id: 'visits', label: 'Visits', sourceType: 'field', sourceId: 'total_patients_seen', format: 'integer' },
      { id: 'new_patients', label: 'New Patients', sourceType: 'field', sourceId: 'new_patients_seen', format: 'integer' },
      { id: 'follow_up', label: 'Follow-Up', sourceType: 'field', sourceId: 'follow_up_patients', format: 'integer' },
      { id: 'no_show', label: 'No-Show', sourceType: 'field', sourceId: 'failed_to_come', format: 'integer' },
    ],
    chartMappings: [
      {
        id: 'visit_mix',
        title: 'Visit Mix',
        chartType: 'stacked-bar',
        series: [
          { sourceType: 'field', sourceId: 'new_patients_seen', label: 'New', color: '#0f8ea8' },
          { sourceType: 'field', sourceId: 'follow_up_patients', label: 'Follow-up', color: '#1a5f7a' },
        ],
      },
      {
        id: 'access_delays',
        title: 'Access Pressure',
        chartType: 'line',
        series: [
          { sourceType: 'field', sourceId: 'wait_time_new_days', label: 'New Wait (days)', color: '#f59e0b' },
          { sourceType: 'field', sourceId: 'failed_to_come', label: 'Failed to Come', color: '#dc2626' },
        ],
      },
    ],
    changeRules: [
      {
        fieldId: 'total_patients_seen',
        percentThreshold: 12,
        messageTemplate: '{department} ART visits changed by {deltaPercent}% compared with last week.',
      },
      {
        fieldId: 'failed_to_come',
        percentThreshold: 10,
        messageTemplate: '{department} clinic no-shows moved from {previousValue} to {currentValue}.',
      },
    ],
  },
  {
    id: 'eeg_weekly',
    family: 'procedure',
    name: 'EEG',
    description: 'Weekly operational reporting for electroencephalography services.',
    activeDays: weekdaysClinic,
    sections: procedureSections,
    fields: [
      numericField('eeg_done', 'Total Number of Patients Who have EEG done', 'throughput'),
      decimalAverageField('eeg_wait_tests', 'Average Waiting Time for EEG tests', 'turnaround', 'days'),
      numericField('eeg_report_received', 'Total Number of Patients Who Received EEG Report', 'throughput'),
      decimalAverageField('eeg_wait_reports', 'Average Waiting Time for EEG Reports', 'turnaround', 'days'),
      numericField('ncs_done', 'Total Number of Patients Who have Nerve Conduction Study (NCS)', 'throughput'),
      numericField('emg_done', 'Total Number of Patients Who have Electromyography (EMG) testing', 'throughput'),
      numericField('ep_done', 'Total Number of Patients Who have Evoked Potential (EP) testing', 'throughput'),
      textField('reporting_staff', 'Name of Reporting Nurse or EEG Technician', 'staffing'),
    ],
    summaryCards: [
      { id: 'eeg_done', label: 'EEG Done', sourceType: 'field', sourceId: 'eeg_done', format: 'integer' },
      { id: 'reports', label: 'Reports Issued', sourceType: 'field', sourceId: 'eeg_report_received', format: 'integer' },
      { id: 'wait', label: 'Test Wait', sourceType: 'field', sourceId: 'eeg_wait_tests', format: 'days' },
    ],
    chartMappings: [
      {
        id: 'eeg_volume',
        title: 'EEG Throughput',
        chartType: 'line',
        series: [
          { sourceType: 'field', sourceId: 'eeg_done', label: 'EEG', color: '#0f8ea8' },
          { sourceType: 'field', sourceId: 'ncs_done', label: 'NCS', color: '#1a5f7a' },
          { sourceType: 'field', sourceId: 'emg_done', label: 'EMG', color: '#0f766e' },
        ],
      },
    ],
    changeRules: [
      {
        fieldId: 'eeg_done',
        percentThreshold: 10,
        messageTemplate: '{department} EEG throughput changed by {deltaPercent}% versus last week.',
      },
    ],
  },
  {
    id: 'echocardiography_weekly',
    family: 'procedure',
    name: 'Echocardiography Lab',
    description: 'Weekly diagnostic throughput and turnaround reporting for echo services.',
    activeDays: weekdaysClinic,
    sections: procedureSections,
    fields: [
      numericField('echo_done', 'Total Number of Patients Who have Echocardiography done', 'throughput'),
      decimalAverageField('echo_wait_tests', 'Average Waiting Time for Echocardiography tests', 'turnaround', 'days'),
      numericField('echo_report_received', 'Total Number of Patients Who Received Echocardiography Report', 'throughput'),
      decimalAverageField('echo_wait_reports', 'Average Waiting Time for Echocardiography Reports', 'turnaround', 'days'),
      numericField('stress_echo', 'Total Number of Patients Who have Stress Echocardiography', 'throughput'),
      numericField('tee', 'Total Number of Patients Who have TEE', 'throughput'),
      numericField('ecg_done', 'Total Number of Patients Who have ECG done', 'throughput'),
      numericField('stress_ecg', 'Total Number of Patients Who have Stress ECG', 'throughput'),
      numericField('ambulatory_ecg', 'Total Number of Patients Who have Ambulatory ECG', 'throughput'),
      numericField('angiography_screening', 'Total Number of Patients Who have Angiography Screening', 'throughput'),
      numericField('valvotomy_screening', 'Total Number of Patients Who have Valvotomy Screening', 'throughput'),
      textField('reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'staffing'),
    ],
    summaryCards: [
      { id: 'echo_done', label: 'Echo Done', sourceType: 'field', sourceId: 'echo_done', format: 'integer' },
      { id: 'ecg_done', label: 'ECG Done', sourceType: 'field', sourceId: 'ecg_done', format: 'integer' },
      { id: 'echo_wait_tests', label: 'Wait Time', sourceType: 'field', sourceId: 'echo_wait_tests', format: 'days' },
    ],
    chartMappings: [
      {
        id: 'echo_volume',
        title: 'Echo Lab Volume',
        chartType: 'stacked-bar',
        series: [
          { sourceType: 'field', sourceId: 'echo_done', label: 'Echo', color: '#0f8ea8' },
          { sourceType: 'field', sourceId: 'ecg_done', label: 'ECG', color: '#1a5f7a' },
          { sourceType: 'field', sourceId: 'stress_ecg', label: 'Stress ECG', color: '#0f766e' },
        ],
      },
    ],
    changeRules: [
      {
        fieldId: 'echo_done',
        percentThreshold: 10,
        messageTemplate: '{department} echocardiography throughput changed by {deltaPercent}% versus last week.',
      },
    ],
  },
  {
    id: 'endoscopy_weekly',
    family: 'procedure',
    name: 'Endoscopy Lab',
    description: 'Weekly reporting for endoscopy throughput and procedure mix.',
    activeDays: weekdaysClinic,
    sections: procedureSections,
    fields: [
      numericField('upper_gi_elective', 'Total Number of Patients Who have Elective Upper GI Endoscopy', 'throughput'),
      decimalAverageField('upper_gi_wait', 'Average Waiting Time for Elective Upper GI Endoscopy', 'turnaround', 'days'),
      numericField('upper_gi_report_received', 'Total Number of Patients Who Received Upper GI Endoscopy Report (Elective Only)', 'throughput'),
      decimalAverageField('upper_gi_report_wait', 'Average Waiting Time for Upper GI Endoscopy Reports (Elective Only)', 'turnaround', 'days'),
      numericField('upper_gi_emergency', 'Total Number of Patients Who have Emergency Upper GI Endoscopy', 'throughput'),
      numericField('ercp', 'Total Number of Patients Who have ERCP', 'throughput'),
      numericField('colonoscopy', 'Total Number of Patients Who have Colonoscopy', 'throughput'),
      numericField('proctoscopy', 'Total Number of Patients Who have Proctoscopy', 'throughput'),
      numericField('bronchoscopy', 'Total Number of Patients Who have Bronchoscopy', 'throughput'),
      numericField('therapeutic_upper_gi', 'Total Number of Patients Who have Upper GI Endoscopic Therapeutic Procedures', 'throughput'),
      numericField('esophageal_dilation', 'Esophageal Dilation', 'throughput'),
      numericField('variceal_ligation', 'Variceal Ligation', 'throughput'),
      numericField('stenting', 'Stenting', 'throughput'),
      numericField('liver_biopsy', 'Total Number of Patients Who have Liver Biopsy', 'throughput'),
      textField('reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'staffing'),
    ],
    summaryCards: [
      { id: 'upper_gi_elective', label: 'Elective UGI', sourceType: 'field', sourceId: 'upper_gi_elective', format: 'integer' },
      { id: 'ercp', label: 'ERCP', sourceType: 'field', sourceId: 'ercp', format: 'integer' },
      { id: 'upper_gi_wait', label: 'Wait Time', sourceType: 'field', sourceId: 'upper_gi_wait', format: 'days' },
    ],
    chartMappings: [
      {
        id: 'endoscopy_mix',
        title: 'Endoscopy Mix',
        chartType: 'stacked-bar',
        series: [
          { sourceType: 'field', sourceId: 'upper_gi_elective', label: 'Elective UGI', color: '#0f8ea8' },
          { sourceType: 'field', sourceId: 'upper_gi_emergency', label: 'Emergency UGI', color: '#1a5f7a' },
          { sourceType: 'field', sourceId: 'colonoscopy', label: 'Colonoscopy', color: '#0f766e' },
        ],
      },
    ],
    changeRules: [
      {
        fieldId: 'upper_gi_elective',
        percentThreshold: 10,
        messageTemplate: '{department} elective endoscopy volume changed by {deltaPercent}% versus last week.',
      },
    ],
  },
  {
    id: 'hematology_procedures_weekly',
    family: 'procedure',
    name: 'Hematology Procedures',
    description: 'Weekly procedure volume and waiting time reporting for hematology services.',
    activeDays: weekdaysClinic,
    sections: procedureSections,
    fields: [
      numericField('bone_marrow_biopsy', 'Total Number of Patients Who have Bone Marrow biopsy', 'throughput'),
      decimalAverageField('bone_marrow_wait', 'Average Waiting Time for Elective Bone Marrow Biopsy', 'turnaround', 'days'),
      textField('reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'staffing'),
    ],
    summaryCards: [
      { id: 'bone_marrow_biopsy', label: 'Biopsies', sourceType: 'field', sourceId: 'bone_marrow_biopsy', format: 'integer' },
      { id: 'bone_marrow_wait', label: 'Wait Time', sourceType: 'field', sourceId: 'bone_marrow_wait', format: 'days' },
    ],
    chartMappings: [
      {
        id: 'bone_marrow_trend',
        title: 'Bone Marrow Procedures',
        chartType: 'line',
        series: [
          { sourceType: 'field', sourceId: 'bone_marrow_biopsy', label: 'Biopsy', color: '#0f8ea8' },
        ],
      },
    ],
    changeRules: [
      {
        fieldId: 'bone_marrow_biopsy',
        percentThreshold: 10,
        messageTemplate: '{department} hematology procedures changed by {deltaPercent}% versus last week.',
      },
    ],
  },
  {
    id: 'bronchoscopy_weekly',
    family: 'procedure',
    name: 'Bronchoscopy Lab',
    description: 'Weekly bronchoscopy volume and waiting time reporting.',
    activeDays: weekdaysClinic,
    sections: procedureSections,
    fields: [
      numericField('bronchoscopy_done', 'Total Number of Patients Who have Bronchoscopy', 'throughput'),
      decimalAverageField('bronchoscopy_wait', 'Average Waiting Time for Bronchoscopy', 'turnaround', 'days'),
      textField('reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'staffing'),
    ],
    summaryCards: [
      { id: 'bronchoscopy_done', label: 'Bronchoscopy', sourceType: 'field', sourceId: 'bronchoscopy_done', format: 'integer' },
      { id: 'bronchoscopy_wait', label: 'Wait Time', sourceType: 'field', sourceId: 'bronchoscopy_wait', format: 'days' },
    ],
    chartMappings: [
      {
        id: 'bronchoscopy_trend',
        title: 'Bronchoscopy Throughput',
        chartType: 'line',
        series: [
          { sourceType: 'field', sourceId: 'bronchoscopy_done', label: 'Bronchoscopy', color: '#0f8ea8' },
        ],
      },
    ],
    changeRules: [
      {
        fieldId: 'bronchoscopy_done',
        percentThreshold: 10,
        messageTemplate: '{department} bronchoscopy volume changed by {deltaPercent}% versus last week.',
      },
    ],
  },
  {
    id: 'renal_procedures_weekly',
    family: 'procedure',
    name: 'Renal Procedures',
    description: 'Weekly renal diagnostic and intervention throughput reporting.',
    activeDays: weekdaysAll,
    sections: procedureSections,
    fields: [
      numericField('elective_renal_biopsy', 'Total Number of Patients Who have Elective Renal Biopsy', 'throughput'),
      numericField(
        'central_venous_catheter_insertion',
        'Total Number of patients with Central Venous Catheter insertion',
        'throughput',
      ),
      decimalAverageField('elective_renal_biopsy_wait', 'Average Waiting Time for Elective Renal Biopsy', 'turnaround', 'days'),
      numericField('hd_acute', 'Total Number of Patients Who have Haemodialysis for Acute Renal Failure', 'throughput'),
      numericField('hd_chronic', 'Total Number of Patients Who have Haemodialysis for Chronic Renal Failure', 'throughput'),
      textField('reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'staffing'),
    ],
    summaryCards: [
      { id: 'elective_renal_biopsy', label: 'Renal Biopsy', sourceType: 'field', sourceId: 'elective_renal_biopsy', format: 'integer' },
      {
        id: 'central_venous_catheter_insertion',
        label: 'CVC Inserts',
        sourceType: 'field',
        sourceId: 'central_venous_catheter_insertion',
        format: 'integer',
      },
      { id: 'hd_chronic', label: 'HD Chronic', sourceType: 'field', sourceId: 'hd_chronic', format: 'integer' },
      { id: 'elective_renal_biopsy_wait', label: 'Wait Time', sourceType: 'field', sourceId: 'elective_renal_biopsy_wait', format: 'days' },
    ],
    chartMappings: [
      {
        id: 'renal_mix',
        title: 'Renal Procedure Mix',
        chartType: 'stacked-bar',
        series: [
          { sourceType: 'field', sourceId: 'elective_renal_biopsy', label: 'Biopsy', color: '#0f8ea8' },
          {
            sourceType: 'field',
            sourceId: 'central_venous_catheter_insertion',
            label: 'CVC',
            color: '#446b95',
          },
          { sourceType: 'field', sourceId: 'hd_acute', label: 'HD Acute', color: '#1a5f7a' },
          { sourceType: 'field', sourceId: 'hd_chronic', label: 'HD Chronic', color: '#0f766e' },
        ],
      },
    ],
    changeRules: [
      {
        fieldId: 'hd_chronic',
        percentThreshold: 8,
        messageTemplate: '{department} chronic haemodialysis throughput changed by {deltaPercent}% versus last week.',
      },
    ],
  },
]

export const templateMap = Object.fromEntries(
  reportTemplates.map((template) => [template.id, template]),
) as Record<string, ReportTemplateConfig>

export const departments: Department[] = [
  { id: 'gi_neuro_inpatient', name: 'GI/Neurology', family: 'inpatient', templateId: 'inpatient_weekly', description: 'Inpatient GI and neurology ward reporting.', accent: '#1b7f8f', bedCount: 26 },
  { id: 'cardiac_inpatient', name: 'Cardiac', family: 'inpatient', templateId: 'inpatient_weekly', description: 'Cardiac inpatient ward.', accent: '#155e75', bedCount: 22 },
  { id: 'nephrology_inpatient', name: 'Nephrology', family: 'inpatient', templateId: 'inpatient_weekly', description: 'Nephrology inpatient ward.', accent: '#0f766e', bedCount: 20 },
  { id: 'chest_inpatient', name: 'Chest', family: 'inpatient', templateId: 'inpatient_weekly', description: 'Chest inpatient ward.', accent: '#0284c7', bedCount: 18 },
  { id: 'hematology_inpatient', name: 'Hematology', family: 'inpatient', templateId: 'inpatient_weekly', description: 'Hematology inpatient ward.', accent: '#0f5f74', bedCount: 16 },
  { id: 'oncology_inpatient', name: 'Oncology', family: 'inpatient', templateId: 'inpatient_weekly', description: 'Oncology inpatient ward.', accent: '#0f4c81', bedCount: 24 },
  { id: 'hdu_inpatient', name: 'HDU', family: 'inpatient', templateId: 'inpatient_weekly', description: 'High dependency unit reporting.', accent: '#164e63', bedCount: 12 },
  { id: 'outpatient_main', name: 'ART', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Outpatient ART clinic reporting.', accent: '#0f8ea8' },
  { id: 'gi_outpatient', name: 'GI', family: 'outpatient', templateId: 'outpatient_weekly', description: 'GI outpatient clinic.', accent: '#0d9488' },
  { id: 'neuro_outpatient', name: 'Neuro', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Neurology outpatient clinic.', accent: '#2563eb' },
  { id: 'cardiac_outpatient', name: 'Cardiac', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Cardiac outpatient clinic.', accent: '#0f766e' },
  { id: 'nephrology_outpatient', name: 'Nephrology', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Nephrology outpatient clinic.', accent: '#0f8ea8' },
  { id: 'chest_outpatient', name: 'Chest', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Chest outpatient clinic.', accent: '#1d4ed8' },
  { id: 'hematology_outpatient', name: 'Hematology', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Hematology outpatient clinic.', accent: '#075985' },
  { id: 'oncology_outpatient', name: 'Oncology', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Oncology outpatient clinic.', accent: '#155e75' },
  { id: 'endocrine_outpatient', name: 'Endocrine', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Endocrine outpatient clinic.', accent: '#0f766e' },
  { id: 'opd_28', name: 'OPD 28', family: 'outpatient', templateId: 'outpatient_weekly', description: 'OPD 28 clinic reporting.', accent: '#0e7490' },
  { id: 'rheumatology_outpatient', name: 'Rheumatology', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Rheumatology clinic reporting.', accent: '#0284c7' },
  { id: 'id_outpatient', name: 'ID', family: 'outpatient', templateId: 'outpatient_weekly', description: 'Infectious disease clinic.', accent: '#1d4ed8' },
  { id: 'eeg_lab', name: 'Electroencephalography (EEG)', family: 'procedure', templateId: 'eeg_weekly', description: 'EEG weekly operational report.', accent: '#0f8ea8' },
  { id: 'echocardiography_lab', name: 'Echocardiography Lab', family: 'procedure', templateId: 'echocardiography_weekly', description: 'Echocardiography service report.', accent: '#0f766e' },
  { id: 'endoscopy_lab', name: 'Endoscopy Lab', family: 'procedure', templateId: 'endoscopy_weekly', description: 'Endoscopy service report.', accent: '#155e75' },
  { id: 'hematology_procedures', name: 'Hematology Procedures', family: 'procedure', templateId: 'hematology_procedures_weekly', description: 'Hematology procedure service report.', accent: '#1d4ed8' },
  { id: 'bronchoscopy_lab', name: 'Bronchoscopy Lab', family: 'procedure', templateId: 'bronchoscopy_weekly', description: 'Bronchoscopy service report.', accent: '#0284c7' },
  { id: 'renal_procedures', name: 'Renal Procedures', family: 'procedure', templateId: 'renal_procedures_weekly', description: 'Renal procedure service report.', accent: '#0f766e' },
]

export const departmentMap = Object.fromEntries(
  departments.map((department) => [department.id, department]),
) as Record<string, Department>
