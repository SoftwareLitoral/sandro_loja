
import 'dotenv/config';
import OpenAI from 'openai';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIRETORIO_IMAGENS = path.resolve(
  __dirname,
  '../uploads/produtos'
);

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function gerarImagemProduto(prisma, produto) {
  if (!openai) {
    console.warn('OPENAI_API_KEY não configurada. Produto ficará sem foto.');
    return null;
  }

  let arquivo = null;

  try {
    await mkdir(DIRETORIO_IMAGENS, { recursive: true });

    const prompt = `
Crie uma fotografia comercial profissional para uma loja virtual.

Produto: ${produto.name}

Descrição: ${produto.description || produto.name}

Categoria: ${produto.category?.name || 'Produto'}

Requisitos:
- Fotografia de produto realista e de alta qualidade.
- Mostrar claramente o produto.
- Fundo de estúdio claro, neutro e elegante.
- Iluminação profissional e sombras suaves.
- Produto centralizado.
- Composição quadrada para catálogo de e-commerce.
- Aparência de fotografia real, não desenho.
- Não incluir textos, letras, logotipos ou marcas d'água.
- Não adicionar elementos que não façam parte do produto.
- Uma única imagem de produto.
`;

    console.log(`Gerando imagem para: ${produto.name}`);

    const resposta = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare',
      prompt,
      size: '1024x1024',
      quality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
      output_format: 'jpeg',
      n: 1
    });

    const base64 = resposta.data?.[0]?.b64_json;

    if (!base64) {
      throw new Error('A API não retornou os dados da imagem.');
    }

    const nomeArquivo = `${produto.id}-${randomUUID()}.jpg`;

    arquivo = path.join(DIRETORIO_IMAGENS, nomeArquivo);

    await writeFile(arquivo, Buffer.from(base64, 'base64'));

    const urlImagem = `/uploads/produtos/${nomeArquivo}`;

    const imagem = await prisma.productImage.create({
      data: {
        productId: produto.id,
        url: urlImagem,
        alt: `Fotografia de ${produto.name}`,
        position: 0
      }
    });

    console.log('Imagem gerada e salva com sucesso!');
    console.log(`Arquivo: ${nomeArquivo}`);
    console.log(`URL: ${imagem.url}`);

    return imagem;

  } catch (erro) {
    // Evitar deixar arquivos sem registro no banco
    if (arquivo) {
      const { unlink } = await import('node:fs/promises');

      await unlink(arquivo).catch(() => {});
    }

    console.error(`Falha ao gerar imagem de ${produto.name}:`);
    console.error(erro.message || erro);

    return null;
  }
}
