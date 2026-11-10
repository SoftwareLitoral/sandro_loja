
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const INTERVALO = 5 * 60 * 1000;

let executando = false;
let encerrando = false;
let temporizador = null;

// Produtos organizados por categoria.
const PRODUTOS_POR_CATEGORIA = {
    roupa: [
        'Camiseta masculina',
        'Camiseta estampada',
        'Moletom especial',
        'Jaqueta casual',
        'Calça jeans',
        'Camisa social',
        'Blusa feminina',
        'Short casual',
        'Jaqueta esportiva',
        'Regata básica'
    ],

    sapatos: [
        'Tênis esportivo',
        'Tênis casual',
        'Sapato social',
        'Sandália feminina',
        'Bota masculina',
        'Chinelo confortável',
        'Sapatênis casual',
        'Tênis de caminhada',
        'Sapato masculino',
        'Sandália casual'
    ],

    esporte: [
        'Bola de futebol',
        'Mochila esportiva',
        'Camisa esportiva',
        'Short de treino',
        'Garrafa esportiva',
        'Luva de academia',
        'Corda de pular',
        'Bolsa esportiva',
        'Acessório de treinamento',
        'Calção esportivo'
    ]
};

function numeroAleatorio(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function escolherItem(lista) {
    return lista[numeroAleatorio(0, lista.length - 1)];
}

function normalizarSlug(slug) {
    return String(slug || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function escolherProduto(categorias) {
    const disponiveis = categorias
        .map((categoria) => ({
            categoria,
            produtos: PRODUTOS_POR_CATEGORIA[
                normalizarSlug(categoria.slug)
            ]
        }))
        .filter((item) => item.produtos?.length);

    if (disponiveis.length === 0) {
        throw new Error(
            'Nenhuma categoria possui produtos configurados. ' +
            'Confira os slugs cadastrados no banco de dados.'
        );
    }

    const escolhido = escolherItem(disponiveis);

    return {
        categoria: escolhido.categoria,
        nome: escolherItem(escolhido.produtos)
    };
}

async function cadastrarProduto() {
    if (executando || encerrando) return;

    executando = true;

    try {
        const categorias = await prisma.category.findMany();

        if (categorias.length === 0) {
            console.log('Nenhuma categoria encontrada.');
            return;
        }

        // Escolhe o nome de acordo com a categoria.
        const { categoria, nome: nomeBase } =
            escolherProduto(categorias);

        const identificador =
            `${Date.now()}-${randomBytes(3).toString('hex')}`;

        const preco = numeroAleatorio(2990, 19990);
        const estoque = numeroAleatorio(5, 30);

        // Cadastra o produto sem gerar imagem.
        const produto = await prisma.product.create({
            data: {
                name: nomeBase,
                slug: `${normalizarSlug(nomeBase).replace(/\s+/g, '-')}-${identificador}`,
                description:
                    `${nomeBase}. Produto cadastrado automaticamente para a Loja do Sandro.`,
                shortDescription:
                    `${nomeBase} disponível na Loja do Sandro.`,
                priceCents: preco,
                compareAtCents: null,
                stock: estoque,
                active: true,
                featured: false,
                category: {
                    connect: {
                        id: categoria.id
                    }
                }
            },
            include: {
                category: true
            }
        });

        console.log('\n------------------------------------------');
        console.log('CADASTRO AUTOMÁTICO DE PRODUTO');
        console.log(`Data: ${new Date().toLocaleString('pt-BR')}`);
        console.log(`ID: ${produto.id}`);
        console.log(`Nome: ${produto.name}`);
        console.log(`Categoria: ${produto.category.name}`);
        console.log(`Slug: ${produto.slug}`);
        console.log(`Preço: R$ ${(produto.priceCents / 100).toFixed(2)}`);
        console.log(`Estoque: ${produto.stock}`);
        console.log('Imagem: 📦 Sem foto (IA desativada).');
        console.log('Produto cadastrado com sucesso!');
        console.log('------------------------------------------');

    } catch (erro) {
        console.error('\nERRO AO CADASTRAR PRODUTO:');
        console.error(erro.message || erro);

    } finally {
        executando = false;

        if (!encerrando) {
            agendarProximoCadastro();
        }
    }
}

function agendarProximoCadastro() {
    if (encerrando) return;

    console.log('\nPróximo produto em 5 minutos.');

    temporizador = setTimeout(() => {
        cadastrarProduto();
    }, INTERVALO);
}

async function iniciar() {
    try {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL não encontrada no .env');
        }

        await prisma.$connect();

        console.log('Conexão com MySQL estabelecida.');
        console.log('Cadastro automático de produtos iniciado.');
        console.log('Geração de imagens por IA: DESATIVADA.');
        console.log('Intervalo: 5 minutos.');

        // Primeiro cadastro imediato.
        await cadastrarProduto();

    } catch (erro) {
        console.error('Falha ao iniciar:', erro.message || erro);

        await prisma.$disconnect();
        process.exitCode = 1;
    }
}

async function encerrar() {
    if (encerrando) return;

    encerrando = true;

    console.log('\nEncerrando cadastro automático...');

    if (temporizador) {
        clearTimeout(temporizador);
    }

    while (executando) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await prisma.$disconnect();

    console.log('Conexão com MySQL encerrada.');
    process.exit(0);
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

iniciar();
