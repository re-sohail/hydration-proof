export default function Layout({ children, modal }) {
  return (
    <div id="gallery">
      {children}
      {modal}
    </div>
  );
}
