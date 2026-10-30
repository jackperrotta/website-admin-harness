/** Credentials only for isolated local fixtures. Never included in runtime packages. */
export const syntheticNotificationBindings={
 SCHEDULING_NOTIFICATIONS_ENABLED:'1',
 SCHEDULING_TOKEN_KEYS:JSON.stringify({current:'fixture',keys:{fixture:Buffer.alloc(32,41).toString('base64url')}}),
 SCHEDULING_EMAIL_FROM:'appointments@fixture.example.test',
 SCHEDULING_TEST_RECIPIENTS:JSON.stringify(['website@example.test','customer@example.test','website-customer@example.test','calendar@example.test']),
};
