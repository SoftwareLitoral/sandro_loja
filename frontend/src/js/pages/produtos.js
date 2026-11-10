import { api } from '../api.js';
import { mountLayout } from '../layout.js';
import {
  productCard,
  setLoading,
  toast,
  emptyState,
} from '../ui.js';

const form = document.getElementById('filters');
const container = document.getElementById('products');
const countLabel = document.getElementById('result-count');
const pagination = document.getElementById('pagination');
const activeFilters = document.getElementById('active-filters');

let requestId = 0;

function currentFilters(page = 1) {
  const data = new FormData(form);

  const filters = {
    page,
    limit: 12,
    sort: data.get('sort') || 'relevance',
  };

  const search = String(data.get('search') || '').trim();
  const category = String(data.get('category') || '').trim();
  const minPrice = String(data.get('minPrice') || '').trim();
  const maxPrice = String(data.get('maxPrice') || '').trim();

  if (search) filters.search = search;
  if (category) filters.category = category;
  if (minPrice) filters.minPrice = minPrice;
  if (maxPrice) filters.maxPrice = maxPrice;

  if (data.get('featured')) {
    filters.featured = 'true';
  }

  return filters;
}

function updateUrl(filters) {
  const urlParams = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      urlParams.set(key, String(value));
    }
  });

  const query = urlParams.toString();

  const newUrl = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;

  window.history.replaceState({}, '', newUrl);
}

function describeFilters(filters) {
  const parts = [];

  if (filters.search) {
    parts.push(`Busca: "${filters.search}"`);
  }

  if (filters.category) {
    parts.push(`Categoria: ${filters.category}`);
  }

  if (filters.featured === 'true') {
    parts.push('Somente destaques');
  }

  if (filters.minPrice || filters.maxPrice) {
    parts.push(
      `Preço: R$ ${filters.minPrice || '0'} até R$ ${filters.maxPrice || '∞'}`
    );
  }

  return parts.length ? parts.join(' • ') : 'Sem filtros';
}

async function loadProducts(page = 1) {
  const id = ++requestId;
  const filters = currentFilters(page);

  updateUrl(filters);

  setLoading(container, true);
  pagination.innerHTML = '';
  activeFilters.textContent = describeFilters(filters);

  const query = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    query.set(key, String(value));
  });

  try {
    const response = await api.get(`/products?${query.toString()}`);

    // Ignora respostas antigas quando outra busca já foi iniciada.
    if (id !== requestId) return;

    const data = response?.data || [];
    const pageData = response?.pagination;

    if (!pageData) {
      throw new Error('A API não retornou os dados da paginação.');
    }

    countLabel.textContent =
      `${pageData.total} produto(s) encontrado(s)`;
    // Encerra o carregamento e descarta o conteúdo antigo guardado.
    setLoading(container, false);

    // Agora coloca os produtos atualizados na tela.
    container.innerHTML = data.length
      ? data.map(productCard).join('')
      : emptyState(
        'Nenhum produto encontrado',
        'Tente ajustar os filtros ou buscar por outro termo.',
        '<a href="/src/pages/produtos.html" class="btn-primary mt-2">Ver todos os produtos</a>'
      );

    renderPagination(pageData);
  } catch (error) {
    if (id !== requestId) return;

    container.innerHTML = emptyState(
      'Erro ao carregar produtos',
      error.message
    );

    countLabel.textContent =
      'Não foi possível carregar os produtos.';

    toast(error.message, 'error');
  } finally {
    if (id === requestId) {
      setLoading(container, false);
    }
  }
}

function renderPagination(pageData) {
  if (!pageData || pageData.totalPages <= 1) return;

  const button = (
    label,
    pageNumber,
    disabled = false,
    active = false
  ) => `
    <button
      type="button"
      data-page="${pageNumber}"
      ${disabled ? 'disabled' : ''}
      class="btn-outline !px-3 !py-2 ${active
      ? '!border-brand-600 !bg-brand-600 !text-white'
      : ''
    }"
    >
      ${label}
    </button>
  `;

  let html = button(
    '←',
    pageData.page - 1,
    !pageData.hasPrev
  );

  for (let i = 1; i <= pageData.totalPages; i += 1) {
    html += button(
      i,
      i,
      false,
      i === pageData.page
    );
  }

  html += button(
    '→',
    pageData.page + 1,
    !pageData.hasNext
  );

  pagination.innerHTML = html;

  pagination.querySelectorAll('button[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);

      loadProducts(page);

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    });
  });
}

async function loadCategories() {
  try {
    const response = await api.get('/categories');
    const data = response?.data || [];
    const select = form.elements.category;

    select.innerHTML = '<option value="">Todas as categorias</option>';

    data.forEach((category) => {
      const option = document.createElement('option');

      option.value = category.slug;
      option.textContent = category.name;

      select.appendChild(option);
    });
  } catch (error) {
    console.error('Erro ao carregar categorias:', error);
    toast('Não foi possível carregar as categorias.', 'error');
  }
}

function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);

  form.elements.search.value = params.get('search') || '';
  form.elements.category.value = params.get('category') || '';
  form.elements.sort.value = params.get('sort') || 'relevance';
  form.elements.minPrice.value = params.get('minPrice') || '';
  form.elements.maxPrice.value = params.get('maxPrice') || '';
  form.elements.featured.checked =
    params.get('featured') === 'true';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  console.log('CLIQUE EM APLICAR FILTROS DETECTADO!');

  const min = form.elements.minPrice.value;
  const max = form.elements.maxPrice.value;

  const filters = currentFilters();

  console.log('FILTROS CAPTURADOS:', filters);

  if (min !== '' && Number(min) < 0) {
    toast('O preço mínimo não pode ser negativo.', 'error');
    return;
  }

  if (max !== '' && Number(max) < 0) {
    toast('O preço máximo não pode ser negativo.', 'error');
    return;
  }

  if (min !== '' && max !== '' && Number(min) > Number(max)) {
    toast('O preço mínimo não pode ser maior que o preço máximo.', 'error');
    return;
  }

  console.log('INICIANDO BUSCA...');

  loadProducts(1);
});

form.addEventListener('reset', () => {
  setTimeout(() => {
    form.elements.sort.value = 'relevance';
    loadProducts(1);
  }, 0);
});

mountLayout({
  activePath: '/src/pages/produtos.html',
});

async function initialize() {
  await loadCategories();
  prefillFromUrl();

  const initialPage = Math.max(
    1,
    Number(new URLSearchParams(window.location.search).get('page')) || 1
  );

  loadProducts(initialPage);
}

initialize();