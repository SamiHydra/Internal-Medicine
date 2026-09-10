<?php

declare(strict_types=1);

$redis = new Redis();
$redis->connect('redis', 6379, 2.0);
$started = hrtime(true);
$redis->ping();
echo (hrtime(true) - $started) / 1_000_000, PHP_EOL;
