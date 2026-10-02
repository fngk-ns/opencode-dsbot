# 수익화 이벤트 (인텐트 불필요) ✅

앱에 SKU(상품)·구독을 설정한 경우에만 의미 있음.

## Entitlement (자격)
| 이벤트 | `d` |
|---|---|
| `ENTITLEMENT_CREATE` | Entitlement — 유저/길드가 SKU 를 구매·구독 시작 |
| `ENTITLEMENT_UPDATE` | Entitlement — 구독 갱신·종료일 변경 등 |
| `ENTITLEMENT_DELETE` | Entitlement — 환불·삭제 (※ 구독 만료는 삭제가 아님) ⚠️ |

## Subscription (구독)
| 이벤트 | `d` |
|---|---|
| `SUBSCRIPTION_CREATE` | Subscription |
| `SUBSCRIPTION_UPDATE` | Subscription |
| `SUBSCRIPTION_DELETE` | Subscription |

## 팁 ⚠️
- 권한 판단은 이벤트 캐시 + 필요시 REST `GET /applications/{id}/entitlements` 로 검증.
- 인터랙션 객체의 `entitlements` 필드로도 현재 유저/길드의 자격이 전달된다.
- 구독 상태 전체 이력은 REST 에서 조회.
