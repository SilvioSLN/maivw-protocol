/** Cloud test loader. Import errors must fail the Cloud integration suite. */
export async function loadCloudPaymentComponents() {
  const pRepo = await import("../../../../cloud/payment/src/services/PaymentRepository.js");
  const oStore = await import("../../../../cloud/payment/src/services/OrderStore.js");
  const auth = await import("../../../../cloud/payment/src/utils/auth.js");
  return { InMemoryPaymentRepository: pRepo.InMemoryPaymentRepository, OrderStore: oStore.OrderStore, signJwtToken: auth.signJwtToken, isStandaloneFallback: false };
}
