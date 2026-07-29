<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;

require '/opt/imreport/current/backend/vendor/autoload.php';

$app = require '/opt/imreport/current/backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

return $app;
