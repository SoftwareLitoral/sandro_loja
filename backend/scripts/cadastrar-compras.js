
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// CONFIGURAÇÕES
const INTERVALO_COMPRA = 5 * 60 * 1000;
const INTERVALO_ETAPA = 60 * 1000;
const INTERVALO_VERIFICACAO = 10 * 1000;

const QUANTIDADE = 2;

// Valores em centavos
const FRETE_GRATIS_A_PARTIR = 19900;
const FRETE_PADRAO = 1990;

// Identificação dos pedidos gerados pelo script
const NOTA_AUTOMATICA =
    'Compra gerada automaticamente para teste.';

let executando = false;
let atualizando = false;
let encerrando = false;

let temporizadorCompra = null;
let temporizadorAtualizacao = null;

// --------------------------------------------------
// FUNÇÕES AUXILIARES
// --------------------------------------------------

function escolherAleatorio(lista) {
    return lista[Math.floor(Math.random() * lista.length)];
}

function formatarDinheiro(valor) {
    return `R$ ${(valor / 100).toFixed(2)}`;
}

// --------------------------------------------------
// 1. CADASTRAR UMA COMPRA
// --------------------------------------------------

async function cadastrarCompra() {
    if (executando || encerrando) return;

    executando = true;

    try {
        const resultado = await prisma.$transaction(async (tx) => {

            // Buscar clientes com endereço
            const clientes = await tx.user.findMany({
                where: {
                    role: 'CUSTOMER',
                    addresses: {
                        some: {}
                    }
                },
                include: {
                    addresses: {
                        orderBy: [
                            { isDefault: 'desc' },
                            { createdAt: 'asc' }
                        ]
                    }
                }
            });

            if (clientes.length === 0) {
                return {
                    sucesso: false,
                    mensagem: 'Nenhum cliente com endereço cadastrado.'
                };
            }

            // Buscar produtos ativos com estoque
            const produtos = await tx.product.findMany({
                where: {
                    active: true,
                    stock: {
                        gte: QUANTIDADE
                    }
                },
                include: {
                    images: {
                        orderBy: {
                            position: 'asc'
                        }
                    }
                }
            });

            if (produtos.length === 0) {
                return {
                    sucesso: false,
                    mensagem: 'Nenhum produto disponível em estoque.'
                };
            }

            // Escolher cliente e produto
            const cliente = escolherAleatorio(clientes);
            const produto = escolherAleatorio(produtos);

            const endereco = cliente.addresses[0];

            // Calcular valores
            const subtotalCents =
                produto.priceCents * QUANTIDADE;

            const shippingCents =
                subtotalCents >= FRETE_GRATIS_A_PARTIR
                    ? 0
                    : FRETE_PADRAO;

            const discountCents = 0;

            const totalCents =
                subtotalCents + shippingCents - discountCents;

            // Atualizar estoque
            const estoqueAtualizado = await tx.product.updateMany({
                where: {
                    id: produto.id,
                    active: true,
                    stock: {
                        gte: QUANTIDADE
                    }
                },
                data: {
                    stock: {
                        decrement: QUANTIDADE
                    }
                }
            });

            if (estoqueAtualizado.count !== 1) {
                throw new Error(
                    'Não foi possível atualizar o estoque.'
                );
            }

            // Número único do pedido
            const orderNumber =
                `PED-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

            // Criar pedido
            const pedido = await tx.order.create({
                data: {
                    orderNumber,

                    userId: cliente.id,

                    status: 'PENDING_PAYMENT',

                    paymentMethod: 'PIX',
                    paymentStatus: 'PENDING',

                    shippingMethod: 'STANDARD',

                    subtotalCents,
                    shippingCents,
                    discountCents,
                    totalCents,

                    recipient: endereco.recipient,
                    street: endereco.street,
                    number: endereco.number,
                    complement: endereco.complement,
                    district: endereco.district,
                    city: endereco.city,
                    state: endereco.state,
                    zipCode: endereco.zipCode,

                    notes: NOTA_AUTOMATICA,

                    items: {
                        create: [{
                            productId: produto.id,
                            productName: produto.name,
                            productSlug: produto.slug,

                            imageUrl:
                                produto.images[0]?.url ?? null,

                            unitPriceCents: produto.priceCents,
                            quantity: QUANTIDADE,
                            totalCents: subtotalCents
                        }]
                    }
                },
                include: {
                    items: true
                }
            });

            return {
                sucesso: true,
                pedido,
                cliente,
                produto
            };
        });

        console.log('\n==========================================');
        console.log('NOVA COMPRA CADASTRADA');
        console.log(new Date().toLocaleString('pt-BR'));

        if (!resultado.sucesso) {
            console.log(`AVISO: ${resultado.mensagem}`);
        } else {
            const { pedido, cliente, produto } = resultado;

            console.log(`Pedido: ${pedido.orderNumber}`);
            console.log(`Cliente: ${cliente.name}`);
            console.log(`E-mail: ${cliente.email}`);
            console.log(`Produto: ${produto.name}`);
            console.log(`Quantidade: ${QUANTIDADE}`);
            console.log(`Subtotal: ${formatarDinheiro(pedido.subtotalCents)}`);
            console.log(`Frete: ${formatarDinheiro(pedido.shippingCents)}`);
            console.log(`Total: ${formatarDinheiro(pedido.totalCents)}`);

            console.log('Pagamento: PENDENTE');
            console.log('Entrega: AGUARDANDO PAGAMENTO');
            console.log('Estoque restante:', produto.stock - QUANTIDADE);
        }

        console.log('==========================================');

    } catch (erro) {
        console.error('ERRO AO CADASTRAR COMPRA:', erro);

    } finally {
        executando = false;

        if (!encerrando) {
            agendarProximaCompra();
        }
    }
}

// --------------------------------------------------
// 2. ATUALIZAR PAGAMENTO, CONFIRMAÇÃO E ENTREGA
// --------------------------------------------------

async function atualizarPedidosAutomaticos() {
    if (atualizando || encerrando) return;

    atualizando = true;

    try {
        const pedidos = await prisma.order.findMany({
            where: {
                notes: NOTA_AUTOMATICA,
                status: {
                    in: [
                        'PENDING_PAYMENT',
                        'PAID',
                        'CONFIRMED',
                        'SHIPPED'
                    ]
                }
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        const agora = Date.now();

        for (const pedido of pedidos) {
            const tempoDecorrido =
                agora - new Date(pedido.createdAt).getTime();

            let novoStatus = pedido.status;
            let novoPagamento = pedido.paymentStatus;

            // Cada etapa ocorre após um minuto
            if (tempoDecorrido >= INTERVALO_ETAPA * 4) {
                novoStatus = 'DELIVERED';
                novoPagamento = 'PAID';

            } else if (tempoDecorrido >= INTERVALO_ETAPA * 3) {
                novoStatus = 'SHIPPED';
                novoPagamento = 'PAID';

            } else if (tempoDecorrido >= INTERVALO_ETAPA * 2) {
                novoStatus = 'CONFIRMED';
                novoPagamento = 'PAID';

            } else if (tempoDecorrido >= INTERVALO_ETAPA) {
                novoStatus = 'PAID';
                novoPagamento = 'PAID';
            }

            // Não atualizar se nada mudou
            if (
                novoStatus === pedido.status &&
                novoPagamento === pedido.paymentStatus
            ) {
                continue;
            }

            // Atualização protegida contra concorrência
            const atualizacao = await prisma.order.updateMany({
                where: {
                    id: pedido.id,
                    status: pedido.status,
                    notes: NOTA_AUTOMATICA
                },
                data: {
                    status: novoStatus,
                    paymentStatus: novoPagamento
                }
            });

            if (atualizacao.count === 1) {
                console.log('\n------------------------------------------');
                console.log('ATUALIZAÇÃO AUTOMÁTICA DO PEDIDO');
                console.log(`Pedido: ${pedido.orderNumber}`);
                console.log(`Data: ${new Date().toLocaleString('pt-BR')}`);
                console.log(`Situação anterior: ${pedido.status}`);
                console.log(`Nova situação: ${novoStatus}`);
                console.log(`Pagamento: ${novoPagamento}`);
                console.log('------------------------------------------');
            }
        }

    } catch (erro) {
        console.error('ERRO AO ATUALIZAR PEDIDOS:', erro);

    } finally {
        atualizando = false;
    }
}

// --------------------------------------------------
// 3. AGENDAR PRÓXIMA COMPRA
// --------------------------------------------------

function agendarProximaCompra() {
    if (encerrando) return;

    console.log('\nPróxima compra em 5 minutos.');

    temporizadorCompra = setTimeout(() => {
        cadastrarCompra();
    }, INTERVALO_COMPRA);
}

// --------------------------------------------------
// 4. INICIAR SISTEMA
// --------------------------------------------------

async function iniciar() {
    try {
        if (!process.env.DATABASE_URL) {
            throw new Error(
                'DATABASE_URL não encontrada no arquivo .env'
            );
        }

        await prisma.$connect();

        console.log('\n==========================================');
        console.log('SISTEMA AUTOMÁTICO DE COMPRAS');
        console.log('Conexão com MySQL estabelecida.');
        console.log('Cadastro de compras: a cada 5 minutos.');
        console.log('Atualização dos pedidos: a cada 10 segundos.');
        console.log('Cada etapa: 1 minuto.');
        console.log('==========================================');

        // Verificar pedidos antigos ao iniciar
        await atualizarPedidosAutomaticos();

        // Verificar pedidos continuamente
        temporizadorAtualizacao = setInterval(() => {
            atualizarPedidosAutomaticos();
        }, INTERVALO_VERIFICACAO);

        // Primeira compra imediatamente
        await cadastrarCompra();

    } catch (erro) {
        console.error('FALHA AO INICIAR O SISTEMA:', erro);

        await prisma.$disconnect();
        process.exitCode = 1;
    }
}

// --------------------------------------------------
// 5. ENCERRAR COM SEGURANÇA
// --------------------------------------------------

async function encerrar() {
    if (encerrando) return;

    encerrando = true;

    console.log('\nEncerrando sistema automático...');

    if (temporizadorCompra) {
        clearTimeout(temporizadorCompra);
    }

    if (temporizadorAtualizacao) {
        clearInterval(temporizadorAtualizacao);
    }

    // Aguardar processos em andamento
    while (executando || atualizando) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    await prisma.$disconnect();

    console.log('Conexão com MySQL encerrada.');
    process.exit(0);
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

// INICIAR
iniciar();
