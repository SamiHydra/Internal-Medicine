<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Weekly leadership digest</title>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; color: #1d3047; margin: 0; padding: 24px; background: #f4f6f9;">
    <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 28px;">
        <p style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #005db6; margin: 0 0 6px;">St Paul's Internal Medicine</p>
        <h1 style="font-size: 20px; margin: 0 0 4px;">Weekly leadership digest</h1>
        <p style="color: #5b6169; margin: 0 0 20px;">Reporting period: {{ $digest['periodLabel'] }}</p>

        <table style="width: 100%; border-collapse: collapse;">
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6;">Reports submitted</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold;">
                    {{ $digest['submitted'] }} / {{ $digest['expected'] }} ({{ $digest['deliveryRate'] }}%)
                </td>
            </tr>
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6;">Admissions</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold;">{{ $digest['admissions'] }}</td>
            </tr>
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6;">Discharges</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold;">{{ $digest['discharges'] }}</td>
            </tr>
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6;">Outpatients seen</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold;">{{ $digest['outpatientSeen'] }}</td>
            </tr>
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; color: #ba1a1a;">Deaths</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold; color: #ba1a1a;">{{ $digest['deaths'] }}</td>
            </tr>
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; color: #8a5a00;">Hospital-acquired infections</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold; color: #8a5a00;">{{ $digest['hai'] }}</td>
            </tr>
            <tr>
                <td style="padding: 10px 0;">Open follow-up action items</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold;">{{ $digest['openActionItems'] }}</td>
            </tr>
        </table>

        @if (!empty($digest['academic']))
        <p style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #005db6; margin: 26px 0 4px;">Academic week</p>
        <table style="width: 100%; border-collapse: collapse;">
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6;">Morning sessions recorded</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold;">
                    {{ $digest['academic']['morningRecorded'] }}@if ($digest['academic']['morningNotRecorded'] > 0)<span style="color: #ba1a1a;"> ({{ $digest['academic']['morningNotRecorded'] }} not recorded)</span>@endif
                </td>
            </tr>
            @if ($digest['academic']['morningOnTimeRate'] !== null)
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6;">Morning punctuality</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold;">
                    {{ $digest['academic']['morningOnTimeRate'] }}% on time · avg {{ $digest['academic']['morningAvgDelayMinutes'] }} min late
                </td>
            </tr>
            @endif
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6;">Teaching sessions held</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #eef2f6; text-align: right; font-weight: bold;">
                    {{ $digest['academic']['teachingHeld'] }} of {{ $digest['academic']['teachingExpected'] }} expected
                </td>
            </tr>
            <tr>
                <td style="padding: 10px 0;">Evaluations filed</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold;">
                    {{ $digest['academic']['peerEvaluations'] }} peer · {{ $digest['academic']['studentEvaluations'] }} student
                </td>
            </tr>
        </table>
        @endif

        <p style="color: #8c929b; font-size: 12px; margin: 24px 0 0;">
            Generated automatically from the St Paul's reporting platform.
        </p>
    </div>
</body>
</html>
