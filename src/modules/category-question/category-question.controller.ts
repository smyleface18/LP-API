import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CategoryQuestionService } from './category-question.service';
import { CreateCategoryQuestionDto } from './dto/create-category-question.dto';
import { UpdateCategoryQuestionDto } from './dto/update-category-question.dto';

@Controller('category-question')
export class CategoryQuestionController {
  constructor(private readonly categoryQuestionService: CategoryQuestionService) {}

  @Post()
  create(@Body() createCategoryQuestionDto: CreateCategoryQuestionDto) {
    return this.categoryQuestionService.create(createCategoryQuestionDto);
  }

  @Get()
  findAll() {
    return this.categoryQuestionService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoryQuestionService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCategoryQuestionDto: UpdateCategoryQuestionDto) {
    return this.categoryQuestionService.update(id, updateCategoryQuestionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categoryQuestionService.remove(id);
  }
}
