import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http-error.js';

const productInclude = {
  images: { orderBy: { position: 'asc' } },
  category: { select: { id: true, name: true, slug: true } },
};

/** Serializa o produto para o formato exposto pela API. */
export const serializeProduct = (product) => ({
  id: product.id,
  name: product.name,
  slug: product.slug,
  description: product.description,
  shortDescription: product.shortDescription,
  priceCents: product.priceCents,
  compareAtCents: product.compareAtCents,
  stock: product.stock,
  active: product.active,
  featured: product.featured,
  category: product.category,
  images: product.images.map((img) => ({ id: img.id, url: img.url, alt: img.alt })),
  mainImage: product.images[0]?.url ?? null,
  createdAt: product.createdAt,
});


export async function listProducts(query = {}) {
  // PAGINAÇÃO
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(query.limit, 10) || 12)
  );

  // FILTROS
  const search = String(query.search || '').trim();
  const category = String(query.category || '').trim();
  const featured = query.featured === 'true';

  const where = {
    active: true,
  };

  // BUSCA POR NOME E DESCRIÇÃO
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { shortDescription: { contains: search } },
    ];
  }

  // CATEGORIA
  if (category) {
    where.category = {
      slug: category,
    };
  }

  // DESTAQUES
  if (featured) {
    where.featured = true;
  }

  // FAIXA DE PREÇO
  const minPrice =
    query.minPrice !== undefined && query.minPrice !== ''
      ? Number(query.minPrice)
      : null;

  const maxPrice =
    query.maxPrice !== undefined && query.maxPrice !== ''
      ? Number(query.maxPrice)
      : null;

  if (
    (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) ||
    (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0))
  ) {
    throw HttpError.badRequest('Informe uma faixa de preço válida.');
  }

  if (
    minPrice !== null &&
    maxPrice !== null &&
    minPrice > maxPrice
  ) {
    throw HttpError.badRequest(
      'O preço mínimo não pode ser maior que o preço máximo.'
    );
  }

  if (minPrice !== null || maxPrice !== null) {
    where.priceCents = {};

    if (minPrice !== null) {
      where.priceCents.gte = Math.round(minPrice * 100);
    }

    if (maxPrice !== null) {
      where.priceCents.lte = Math.round(maxPrice * 100);
    }
  }

  // ORDENAÇÃO
  const sortOptions = {
    relevance: { createdAt: 'desc' },
    newest: { createdAt: 'desc' },
    price_asc: { priceCents: 'asc' },
    price_desc: { priceCents: 'desc' },
    name_asc: { name: 'asc' },
    name_desc: { name: 'desc' },
  };

  const sort = String(query.sort || 'relevance');

  const orderBy =
    sortOptions[sort] || sortOptions.relevance;

  // CONSULTA AO BANCO
  const [total, products] = await Promise.all([
    prisma.product.count({
      where,
    }),

    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    data: products.map(serializeProduct),

    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}


export async function getProduct(id) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: productInclude,
  });
  if (!product || !product.active) throw HttpError.notFound('Produto nao encontrado.');
  return serializeProduct(product);
}

export async function getProductBySlug(slug) {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: productInclude,
  });
  if (!product || !product.active) throw HttpError.notFound('Produto nao encontrado.');
  return serializeProduct(product);
}

export async function listFeatured(limit = 8) {
  const products = await prisma.product.findMany({
    where: { active: true, featured: true },
    include: productInclude,
    take: limit,
    orderBy: { createdAt: 'desc' },
  });
  return products.map(serializeProduct);
}

export async function listRelated(product, limit = 4) {
  const products = await prisma.product.findMany({
    where: { active: true, categoryId: product.categoryId, id: { not: product.id } },
    include: productInclude,
    take: limit,
  });
  return products.map(serializeProduct);
}


function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function generateUniqueSlug(name, currentId) {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing || existing.id === currentId) return slug;
    slug = `${base}-${suffix++}`;
  }
}

function productData(data) {
  const result = {};

  if (data.name !== undefined) result.name = data.name;
  if (data.description !== undefined) result.description = data.description;
  if (data.shortDescription !== undefined) {
    result.shortDescription = data.shortDescription || null;
  }
  if (data.price !== undefined) {
    result.priceCents = Math.round(data.price * 100);
  }
  if (data.compareAtPrice !== undefined) {
    result.compareAtCents =
      data.compareAtPrice === null ? null : Math.round(data.compareAtPrice * 100);
  }
  if (data.stock !== undefined) result.stock = data.stock;
  if (data.categoryId !== undefined) result.categoryId = data.categoryId;
  if (data.featured !== undefined) result.featured = data.featured;
  if (data.active !== undefined) result.active = data.active;

  return result;
}

export async function listAdminProducts() {
  const products = await prisma.product.findMany({
    include: productInclude,
    orderBy: { createdAt: 'desc' },
  });

  return products.map(serializeProduct);
}


export async function createProduct(data) {
  const values = productData(data);

  // Valida a categoria antes de cadastrar o produto.
  const categoryId = data.categoryId?.trim();

  if (!categoryId) {
    throw HttpError.badRequest('Selecione uma categoria válida.');
  }

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });

  if (!category) {
    throw HttpError.badRequest(
      'A categoria selecionada não existe no banco de dados. Atualize as categorias e tente novamente.'
    );
  }

  values.categoryId = category.id;
  values.slug = await generateUniqueSlug(data.name);

  const imageUrl = data.imageUrl?.trim();

  const product = await prisma.product.create({
    data: {
      ...values,
      ...(imageUrl
        ? {
            images: {
              create: [
                {
                  url: imageUrl,
                  alt: data.name,
                  position: 0,
                },
              ],
            },
          }
        : {}),
    },
    include: productInclude,
  });

  return serializeProduct(product);
}

export async function updateProduct(id, data) {
  const existing = await prisma.product.findUnique({ where: { id } });

  if (!existing) {
    throw HttpError.notFound('Produto não encontrado.');
  }

  const values = productData(data);

  if (data.name !== undefined) {
    values.slug = await generateUniqueSlug(data.name, id);
  }

  const imageUrl = data.imageUrl?.trim();

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...values,
      ...(data.imageUrl !== undefined
        ? {
            images: {
              deleteMany: {},
              ...(imageUrl
                ? {
                    create: [{
                      url: imageUrl,
                      alt: data.name ?? existing.name,
                      position: 0,
                    }],
                  }
                : {}),
            },
          }
        : {}),
    },
    include: productInclude,
  });

  return serializeProduct(product);
}

export async function deactivateProduct(id) {
  const existing = await prisma.product.findUnique({ where: { id } });

  if (!existing) {
    throw HttpError.notFound('Produto não encontrado.');
  }

  // Desativa sem apagar o histórico de pedidos.
  await prisma.product.update({
    where: { id },
    data: { active: false },
  });

  return { id, active: false };
}


export async function deleteProduct(id) {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { id: true, name: true },
  });

  if (!existing) {
    throw HttpError.notFound('Produto não encontrado.');
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Remove imagens vinculadas ao produto.
      await tx.productImage.deleteMany({
        where: { productId: id },
      });

      // Exclui o produto somente se os relacionamentos permitirem.
      await tx.product.delete({
        where: { id },
      });
    });

    return { id, deleted: true };
  } catch (error) {
    if (error.code === 'P2003' || error.code === 'P2014') {
      throw HttpError.badRequest(
        'Este produto possui vínculos com pedidos ou outros registros e não pode ser excluído permanentemente. Desative-o para preservar o histórico.'
      );
    }

    throw error;
  }
}
