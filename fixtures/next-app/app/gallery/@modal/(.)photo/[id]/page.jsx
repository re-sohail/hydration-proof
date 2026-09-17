export default async function PhotoModal({ params }) {
  const { id } = await params;
  return <dialog open id="photo-modal">Photo {id} (modal)</dialog>;
}
