<?php

namespace App\Support\Export;

use RuntimeException;

/**
 * Collects one worksheet's XML.
 *
 * A full-history workbook is thousands of small form sheets, and giving each one
 * its own temp file cost more than writing the XML did (tempnam + open + close +
 * unlink + a zip entry read back off disk, per sheet). Sheets are therefore held
 * in memory and only spill to a temp file once they pass a threshold, so the
 * bounded-memory guarantee still holds for the genuinely large sheets - the
 * submission index, the wide summaries, and the edit history.
 */
class SheetSink
{
    private string $buffer = '';

    /** @var resource|null */
    private $handle = null;

    private ?string $path = null;

    /**
     * @param  \Closure(): string  $allocateTempPath
     */
    public function __construct(
        private readonly int $limit,
        private readonly \Closure $allocateTempPath,
    ) {}

    public function write(string $chunk): void
    {
        if ($this->handle !== null) {
            fwrite($this->handle, $chunk);

            return;
        }

        $this->buffer .= $chunk;

        if (strlen($this->buffer) >= $this->limit) {
            $this->spill();
        }
    }

    /**
     * Either the XML itself, or the temp file it was spilled to. The caller adds
     * the first to the archive directly and the second by path.
     *
     * @return array{xml: string|null, path: string|null}
     */
    public function finish(): array
    {
        if ($this->handle !== null) {
            fclose($this->handle);
            $this->handle = null;

            return ['xml' => null, 'path' => $this->path];
        }

        return ['xml' => $this->buffer, 'path' => null];
    }

    private function spill(): void
    {
        $this->path = ($this->allocateTempPath)();
        $handle = fopen($this->path, 'wb');

        if ($handle === false) {
            throw new RuntimeException('Unable to open the worksheet spill file.');
        }

        fwrite($handle, $this->buffer);
        $this->handle = $handle;
        $this->buffer = '';
    }
}
