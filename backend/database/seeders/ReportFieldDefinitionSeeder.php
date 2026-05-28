<?php

namespace Database\Seeders;

use App\Models\ReportFieldDefinition;
use App\Models\ReportTemplate;
use Illuminate\Database\Seeder;
use stdClass;

class ReportFieldDefinitionSeeder extends Seeder
{
    public function run(): void
    {
        $templateIds = ReportTemplate::query()->pluck('id', 'slug');

        $fields = [
            ['inpatient_weekly', 'patient_flow', 'total_admitted_patients', 'Total Number of Admitted Patients', 'integer', 'sum', 10],
            ['inpatient_weekly', 'patient_flow', 'new_admitted_patients', 'Number of Newly Admitted Patients', 'integer', 'sum', 20],
            ['inpatient_weekly', 'patient_flow', 'readmitted_30d', 'Number of Newly Readmitted Patients within 30 days of discharge', 'integer', 'sum', 30],
            ['inpatient_weekly', 'quality_safety', 'new_deaths', 'Number of New Deaths', 'integer', 'sum', 40],
            ['inpatient_weekly', 'quality_safety', 'new_pressure_ulcer', 'Number of Patients Who Developed New Pressure Ulcer', 'integer', 'sum', 50],
            ['inpatient_weekly', 'quality_safety', 'total_pressure_ulcer', 'Total Number of Patients With Pressure Ulcer', 'integer', 'sum', 60],
            ['inpatient_weekly', 'quality_safety', 'total_hai', 'Total Number of Patients With Hospital-acquired infections (AIs)', 'integer', 'sum', 70],
            ['inpatient_weekly', 'quality_safety', 'hai_clabsi', 'Central line-associated bloodstream Infection', 'integer', 'sum', 80],
            ['inpatient_weekly', 'quality_safety', 'hai_cauti', 'Catheter-Associated Urinary tract infection', 'integer', 'sum', 90],
            ['inpatient_weekly', 'quality_safety', 'hai_pneumonia', 'Pneumonia', 'integer', 'sum', 100],
            ['inpatient_weekly', 'quality_safety', 'hai_vap', 'Ventilator-associated pneumonia (VAP)', 'integer', 'sum', 110],
            ['inpatient_weekly', 'quality_safety', 'hai_cdi', 'Clostridium difficile infections (CDI)', 'integer', 'sum', 120],
            ['inpatient_weekly', 'quality_safety', 'urinary_catheter', 'Number of New Patients That Are on Urinary Catheter', 'integer', 'sum', 130],
            ['inpatient_weekly', 'patient_flow', 'transferred_icu', 'Number of Patients Transferred to ICU', 'integer', 'sum', 140],
            ['inpatient_weekly', 'patient_flow', 'transferred_hdu', 'Number of Patients Transferred to HDU', 'integer', 'sum', 150],
            ['inpatient_weekly', 'patient_flow', 'transferred_ward', 'Number of Patients Transferred to Ward', 'integer', 'sum', 160],
            ['inpatient_weekly', 'patient_flow', 'discharged_home', 'Number of Patients Discharged Home (Rx Completed)', 'integer', 'sum', 170],
            ['inpatient_weekly', 'patient_flow', 'discharged_ama', 'Number of Patients Discharged Against Medical Advice', 'integer', 'sum', 180],
            ['inpatient_weekly', 'capacity', 'free_beds', 'Number of Free Beds', 'integer', 'sum', 190],
            ['inpatient_weekly', 'capacity', 'median_los_days', 'Median Length of Stay (LOS) in Days', 'decimal', 'average', 200],
            ['inpatient_weekly', 'capacity', 'total_patient_days', 'Total Patient Days', 'integer', 'sum', 210],
            ['inpatient_weekly', 'staffing', 'mdt_round_start_day', 'MDT Round Start Time (Day-working hours)', 'time', 'latest', 220],
            ['inpatient_weekly', 'staffing', 'mdt_round_start_duty', 'MDT Round Start Time (Duty hours)', 'time', 'latest', 230],
            ['inpatient_weekly', 'staffing', 'duty_resident', 'Duty resident', 'text', 'latest', 240],
            ['inpatient_weekly', 'staffing', 'duty_senior_physician', 'Duty senior physician', 'text', 'latest', 250],
            ['inpatient_weekly', 'staffing', 'nurse_in_charge', 'Nurse In Charge (NI) Name', 'text', 'latest', 260],
            ['outpatient_weekly', 'activity', 'total_patients_seen', 'Total Number of Patients Seen', 'integer', 'sum', 10],
            ['outpatient_weekly', 'activity', 'follow_up_patients', 'Number of Follow-up Patients', 'integer', 'sum', 20],
            ['outpatient_weekly', 'activity', 'new_patients_seen', 'Number of New Patients Seen', 'integer', 'sum', 30],
            ['outpatient_weekly', 'activity', 'not_seen_same_day', 'Number of Patients Not Seen on Same Day', 'integer', 'sum', 40],
            ['outpatient_weekly', 'access', 'wait_time_new_days', 'Average Appointment Wait Time For New Patients', 'decimal', 'average', 50],
            ['outpatient_weekly', 'access', 'wait_time_followup_months', 'Average Appointment Wait Time For Follow-up Patients', 'decimal', 'average', 60],
            ['outpatient_weekly', 'access', 'failed_to_come', 'Number of Patients Who Failed to Come For Their Appointment', 'integer', 'sum', 70],
            ['outpatient_weekly', 'access', 'not_seen_appointment', 'Number of Patients Who Are Not Seen During Their Appointment', 'integer', 'sum', 80],
            ['outpatient_weekly', 'staffing', 'clinic_start_time', 'Clinic Start Time', 'time', 'latest', 90],
            ['outpatient_weekly', 'staffing', 'senior_physician_availability', 'Senior physician availability', 'choice', 'latest', 100],
            ['outpatient_weekly', 'staffing', 'nurse_in_charge', 'Nurse In Charge (NI) Name', 'text', 'latest', 110],
            ['eeg_weekly', 'throughput', 'eeg_done', 'Total Number of Patients Who have EEG done', 'integer', 'sum', 10],
            ['eeg_weekly', 'turnaround', 'eeg_wait_tests', 'Average Waiting Time for EEG tests', 'decimal', 'average', 20],
            ['eeg_weekly', 'throughput', 'eeg_report_received', 'Total Number of Patients Who Received EEG Report', 'integer', 'sum', 30],
            ['eeg_weekly', 'turnaround', 'eeg_wait_reports', 'Average Waiting Time for EEG Reports', 'decimal', 'average', 40],
            ['eeg_weekly', 'throughput', 'ncs_done', 'Total Number of Patients Who have Nerve Conduction Study (NCS)', 'integer', 'sum', 50],
            ['eeg_weekly', 'throughput', 'emg_done', 'Total Number of Patients Who have Electromyography (EMG) testing', 'integer', 'sum', 60],
            ['eeg_weekly', 'throughput', 'ep_done', 'Total Number of Patients Who have Evoked Potential (EP) testing', 'integer', 'sum', 70],
            ['eeg_weekly', 'staffing', 'reporting_staff', 'Name of Reporting Nurse or EEG Technician', 'text', 'latest', 80],
            ['echocardiography_weekly', 'throughput', 'echo_done', 'Total Number of Patients Who have Echocardiography done', 'integer', 'sum', 10],
            ['echocardiography_weekly', 'turnaround', 'echo_wait_tests', 'Average Waiting Time for Echocardiography tests', 'decimal', 'average', 20],
            ['echocardiography_weekly', 'throughput', 'echo_report_received', 'Total Number of Patients Who Received Echocardiography Report', 'integer', 'sum', 30],
            ['echocardiography_weekly', 'turnaround', 'echo_wait_reports', 'Average Waiting Time for Echocardiography Reports', 'decimal', 'average', 40],
            ['echocardiography_weekly', 'throughput', 'stress_echo', 'Total Number of Patients Who have Stress Echocardiography', 'integer', 'sum', 50],
            ['echocardiography_weekly', 'throughput', 'tee', 'Total Number of Patients Who have TEE', 'integer', 'sum', 60],
            ['echocardiography_weekly', 'throughput', 'ecg_done', 'Total Number of Patients Who have ECG done', 'integer', 'sum', 70],
            ['echocardiography_weekly', 'throughput', 'stress_ecg', 'Total Number of Patients Who have Stress ECG', 'integer', 'sum', 80],
            ['echocardiography_weekly', 'throughput', 'ambulatory_ecg', 'Total Number of Patients Who have Ambulatory ECG', 'integer', 'sum', 90],
            ['echocardiography_weekly', 'throughput', 'angiography_screening', 'Total Number of Patients Who have Angiography Screening', 'integer', 'sum', 100],
            ['echocardiography_weekly', 'throughput', 'valvotomy_screening', 'Total Number of Patients Who have Valvotomy Screening', 'integer', 'sum', 110],
            ['echocardiography_weekly', 'staffing', 'reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'text', 'latest', 120],
            ['endoscopy_weekly', 'throughput', 'upper_gi_elective', 'Total Number of Patients Who have Elective Upper GI Endoscopy', 'integer', 'sum', 10],
            ['endoscopy_weekly', 'turnaround', 'upper_gi_wait', 'Average Waiting Time for Elective Upper GI Endoscopy', 'decimal', 'average', 20],
            ['endoscopy_weekly', 'throughput', 'upper_gi_report_received', 'Total Number of Patients Who Received Upper GI Endoscopy Report (Elective Only)', 'integer', 'sum', 30],
            ['endoscopy_weekly', 'turnaround', 'upper_gi_report_wait', 'Average Waiting Time for Upper GI Endoscopy Reports (Elective Only)', 'decimal', 'average', 40],
            ['endoscopy_weekly', 'throughput', 'upper_gi_emergency', 'Total Number of Patients Who have Emergency Upper GI Endoscopy', 'integer', 'sum', 50],
            ['endoscopy_weekly', 'throughput', 'ercp', 'Total Number of Patients Who have ERCP', 'integer', 'sum', 60],
            ['endoscopy_weekly', 'throughput', 'colonoscopy', 'Total Number of Patients Who have Colonoscopy', 'integer', 'sum', 70],
            ['endoscopy_weekly', 'throughput', 'proctoscopy', 'Total Number of Patients Who have Proctoscopy', 'integer', 'sum', 80],
            ['endoscopy_weekly', 'throughput', 'bronchoscopy', 'Total Number of Patients Who have Bronchoscopy', 'integer', 'sum', 90],
            ['endoscopy_weekly', 'throughput', 'therapeutic_upper_gi', 'Total Number of Patients Who have Upper GI Endoscopic Therapeutic Procedures', 'integer', 'sum', 100],
            ['endoscopy_weekly', 'throughput', 'esophageal_dilation', 'Esophageal Dilation', 'integer', 'sum', 110],
            ['endoscopy_weekly', 'throughput', 'variceal_ligation', 'Variceal Ligation', 'integer', 'sum', 120],
            ['endoscopy_weekly', 'throughput', 'stenting', 'Stenting', 'integer', 'sum', 130],
            ['endoscopy_weekly', 'throughput', 'liver_biopsy', 'Total Number of Patients Who have Liver Biopsy', 'integer', 'sum', 140],
            ['endoscopy_weekly', 'staffing', 'reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'text', 'latest', 150],
            ['hematology_procedures_weekly', 'throughput', 'bone_marrow_biopsy', 'Total Number of Patients Who have Bone Marrow biopsy', 'integer', 'sum', 10],
            ['hematology_procedures_weekly', 'turnaround', 'bone_marrow_wait', 'Average Waiting Time for Elective Bone Marrow Biopsy', 'decimal', 'average', 20],
            ['hematology_procedures_weekly', 'staffing', 'reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'text', 'latest', 30],
            ['bronchoscopy_weekly', 'throughput', 'bronchoscopy_done', 'Total Number of Patients Who have Bronchoscopy', 'integer', 'sum', 10],
            ['bronchoscopy_weekly', 'turnaround', 'bronchoscopy_wait', 'Average Waiting Time for Bronchoscopy', 'decimal', 'average', 20],
            ['bronchoscopy_weekly', 'staffing', 'reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'text', 'latest', 30],
            ['renal_procedures_weekly', 'throughput', 'elective_renal_biopsy', 'Total Number of Patients Who have Elective Renal Biopsy', 'integer', 'sum', 10],
            ['renal_procedures_weekly', 'throughput', 'central_venous_catheter_insertion', 'Total Number of patients with Central Venous Catheter insertion', 'integer', 'sum', 20],
            ['renal_procedures_weekly', 'turnaround', 'elective_renal_biopsy_wait', 'Average Waiting Time for Elective Renal Biopsy', 'decimal', 'average', 30],
            ['renal_procedures_weekly', 'staffing', 'reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'text', 'latest', 40],
            ['dialysis_weekly', 'throughput', 'dialysis_acute', 'Total Number of Patients Who have Haemodialysis for Acute Renal Failure', 'integer', 'sum', 10],
            ['dialysis_weekly', 'throughput', 'dialysis_chronic', 'Total Number of Patients Who have Haemodialysis for Chronic Renal Failure', 'integer', 'sum', 20],
            ['dialysis_weekly', 'staffing', 'reporting_staff', 'Name of Reporting Nurse or Nurse-in-Charge (NI)', 'text', 'latest', 30],
        ];

        foreach ($fields as [$templateSlug, $sectionKey, $fieldKey, $label, $fieldKind, $aggregateType, $displayOrder]) {
            ReportFieldDefinition::query()->updateOrCreate(
                [
                    'template_id' => $templateIds[$templateSlug],
                    'field_key' => $fieldKey,
                ],
                [
                    'section_key' => $sectionKey,
                    'label' => $label,
                    'field_kind' => $fieldKind,
                    'aggregate_type' => $aggregateType,
                    'display_order' => $displayOrder,
                    'metadata' => $this->metadataFor($fieldKey),
                ],
            );
        }
    }

    private function metadataFor(string $fieldKey): array|stdClass
    {
        if ($fieldKey === 'senior_physician_availability') {
            return [
                'options' => ['Full day', 'Partial day', 'Unavailable'],
            ];
        }

        return new stdClass;
    }
}
