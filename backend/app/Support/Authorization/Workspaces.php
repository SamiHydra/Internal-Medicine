<?php

namespace App\Support\Authorization;

final class Workspaces
{
    public const CLINICAL = 'clinical';

    public const ACADEMIC = 'academic';

    /** A role that belongs to both workspaces and is therefore never filtered out. */
    public const BOTH = 'both';

    /**
     * @return list<string>
     */
    public static function all(): array
    {
        return [self::CLINICAL, self::ACADEMIC, self::BOTH];
    }

    /**
     * The values a request may filter BY. `both` is a property a role carries,
     * not a workspace anyone can be looking at.
     *
     * @return list<string>
     */
    public static function selectable(): array
    {
        return [self::CLINICAL, self::ACADEMIC];
    }
}
