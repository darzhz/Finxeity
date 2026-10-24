# Data extracted and stored by Finxeity

All data is stored locally on the device (Room/DataStore). No network permission in release builds.

## General info

- Money is stored as integer paise (minor units).
- Timestamps are epoch milliseconds.
- Data sources: notifications from monitored apps, optional SMS import, manual entry.
- Raw messages are retained so parsing rules can be re-run; user corrections are carried over on reparse.

## Tables / entities

### Accounts (`accounts`)
| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| name | string | Account name |
| lastDigits | string? | Last 4 digits |
| type | enum | BANK, CARD, WALLET, CASH, OTHER |
| anchorBalanceMinor | int | Balance anchor amount |
| anchorAt | long | Anchor timestamp |
| currency | string | Currency code |
| archived | bool | Soft archive |
| createdAt | long | Creation time |

### Transactions (`transactions`)
| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| rawEventId | string? | Source message id |
| accountId | string? | Linked account |
| amountMinor | int | Amount in paise |
| direction | enum | DEBIT / CREDIT |
| kind | enum | SPEND / INCOME / REFUND / TRANSFER |
| merchantId | string? | Normalized merchant |
| merchantName | string? | Display merchant |
| categoryId | string? | Category link |
| categoryName | string? | Category display |
| referenceId | string? | Bank reference |
| occurredAt | long | Transaction time |
| confidence | double | Parser confidence |
| status | enum | ACTIVE / VOIDED |
| source | enum | AUTO / MANUAL |
| note | string? | User note |
| createdAt | long | Creation time |

### Raw messages (`raw_events`)
| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| source | enum | NOTIFICATION / SMS |
| packageName | string? | Originating app |
| sender | string? | SMS sender |
| notificationKey | string | OS notification key |
| title | string? | Notification title |
| text | string? | Notification text |
| bigText | string? | Expanded text |
| textLines | string? | Line bundle |
| postedAt | long | Posted time |
| contentHash | string | Dedup hash |
| status | enum | CAPTURED / PARSED / IGNORED / NEEDS_REVIEW / DISMISSED |
| dismissedAt | long? | Dismissal time |
| parseVersion | int | Parser version |
| duplicateOf | string? | Duplicate link |
| createdAt | long | Creation time |

### Categories (`categories`)
| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| name | string | Category name |
| kind | enum | EXPENSE / INCOME / TRANSFER |
| color | string? | Display color |
| icon | string? | Display icon |

### Rules (`rules`)
| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| type | enum | IGNORE / CATEGORY |
| packageName | string? | App scope |
| senderPattern | string? | Sender match |
| templatePattern | string? | Template match |
| merchantContains | string? | Merchant match |
| categoryId | string? | Target category |
| enabled | bool | Active flag |
| createdAt | long | Creation time |

### Recurring payments (`recurring` summaries)
| Field | Type | Notes |
|---|---|---|
| merchantId | string? | Merchant link |
| name | string | Merchant name |
| amountMinor | int | Amount |
| cadence | string | WEEKLY / MONTHLY / etc. |
| nextExpectedAt | long? | Next expected date |
| lastSeenAt | long? | Last seen date |
| priceIncreaseMinor | int? | Detected increase |
| status | enum | SUGGESTED / CONFIRMED / IGNORED |
| confirmed | bool | User confirmed |

### Commitments (`commitments`)
| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| name | string | Bill name |
| amountMinor | int | Amount |
| dueAt | long | Due timestamp |
| recurrence | string | Recurrence rule |
| accountId | string? | Linked account |
| categoryId | string? | Category link |
| status | enum | PENDING / PAID / OVERDUE / CANCELLED |
| paidTransactionId | string? | Payment link |
| note | string? | Note |
| createdAt | long | Creation time |

### Goals (`goals`)
| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| name | string | Goal name |
| targetMinor | int | Target amount |
| savedMinor | int | Saved amount |
| targetDate | long? | Target date |
| monthlyContributionMinor | int | Monthly contribution |
| priority | int | Priority |
| status | enum | ACTIVE / PAUSED / COMPLETED |
| createdAt | long | Creation time |

### Budgets (`budgets`)
| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| categoryId | string? | Category scope (null = all) |
| period | enum | WEEKLY / MONTHLY / QUARTERLY / YEARLY |
| limitMinor | int | Limit amount |
| rollover | bool | Rollover unused |
| alertThresholds | string | Threshold list |
| startDay | int | Period start day |
| enabled | bool | Active flag |

### Financial settings (`financial_settings`)
| Field | Type | Notes |
|---|---|---|
| bufferMinor | int | Emergency buffer |
| incomeDay | int | Income day of month |
| expectedIncomeMinor | int | Expected income |
| essentialCategories | string[] | Essential category ids |

### Daily summaries (`daily_summaries`)
| Field | Type | Notes |
|---|---|---|
| dayStart | long | Day boundary |
| accountId | string? | Account scope |
| spendMinor | int | Spend total |
| incomeMinor | int | Income total |
| netMinor | int | Net total |

### Monitored apps (`monitored_apps`)
| Field | Type | Notes |
|---|---|---|
| packages | string[] | Monitored package names |

### SMS import state
| Field | Type | Notes |
|---|---|---|
| supported | bool | Build supports SMS import |
| permissionGranted | bool | SMS permission granted |
| lastImportAt | long | Last import time |

### Listener status
| Field | Type | Notes |
|---|---|---|
| accessGranted | bool | Notification access granted |
| state | enum | UNKNOWN / CONNECTED / DISCONNECTED |
| monitoredCount | int | Number of monitored apps |
| lastEventAt | long | Last event time |
| activeNotifications | int | Active notification count |
EOF
echo done