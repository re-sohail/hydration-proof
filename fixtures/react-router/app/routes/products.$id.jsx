import { useParams } from 'react-router';

export const meta = ({ params }) => [{ title: `Product ${params.id}` }];

export default function Product() {
  const { id } = useParams();
  return (
    <main>
      <h1 id="product">Product {id}</h1>
    </main>
  );
}
